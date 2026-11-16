"""The sandbox's trusted entrypoint.

It reads one JSON envelope on stdin ({language, files, runs, compileTimeoutMs, stdoutLimit, resultLimit, memoryMb}), writes the
files to /tmp/work, compiles them and runs the program once per run, then prints one JSON report on stdout.

It runs as the container's root (with only SETUID, SETGID and KILL), and every compiler and program runs as nobody in its
own process group, so a program can neither read this process nor write to its output: the report, and the times in it, are
measured from outside the program. A program's results go to fd 3 and what it prints to stdout and stderr, each capped.
"""

import json
import os
import resource
import signal
import subprocess
import sys
import threading
import time

ENVELOPE_MARKER = "\n--learnspace-envelope--\n"
NOBODY = 65534
WORK = "/tmp/work"
ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": WORK, "LANG": "C.UTF-8", "TMPDIR": WORK}
STDERR_LIMIT = 16_384
COMPILE_OUTPUT_LIMIT = 16_384
# Held on fd 3 between runs (and never fd 3 itself), so a run's result pipe can take fd 3 and give it back.
RESERVED = os.open("/dev/null", os.O_RDONLY)
if RESERVED == 3:
    RESERVED = os.dup(3)
os.dup2(RESERVED, 3)


def commands(language, memory_mb):
    """(compile command or None, run command) for a language; files are named by the caller's harness."""
    heap = max(64, int(memory_mb * 0.6))
    if language == "python":
        return ["python3", "-I", "-c", "import sys; compile(open('main.py', encoding='utf-8').read(), 'solution.py', 'exec')"], ["python3", "-I", "main.py"]
    if language == "javascript":
        return ["node", "--check", "main.js"], ["node", f"--max-old-space-size={heap}", "--stack-size=65500", "main.js"]
    if language == "typescript":
        check = "const m = require('node:module'); new (require('node:vm').Script)(m.stripTypeScriptTypes(require('node:fs').readFileSync('main.ts', 'utf8')), { filename: 'solution.ts' })"
        return ["node", "--no-warnings", "-e", check], ["node", "--no-warnings", f"--max-old-space-size={heap}", "--stack-size=65500", "main.ts"]
    if language == "java":
        return ["javac", "-encoding", "UTF-8", "-nowarn", "-d", ".", "Main.java", "Solution.java"], ["java", "--add-opens", "java.base/java.io=ALL-UNNAMED", f"-Xmx{heap}m", "-Xss256m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=4", "-cp", ".", "Main"]
    if language == "cpp":
        return ["g++", "-O2", "-std=gnu++17", "-o", "main", "main.cpp"], ["./main"]
    raise ValueError(f"unsupported language {language}")


def limit_child():
    """Runs in the child after it drops to nobody: no core files, bounded files, room for deep recursion."""
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 << 20, 32 << 20))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    hard = resource.getrlimit(resource.RLIMIT_STACK)[1]
    stack = 256 << 20
    resource.setrlimit(resource.RLIMIT_STACK, (stack if hard == resource.RLIM_INFINITY else min(stack, hard), hard))


def oom_kills():
    try:
        with open("/sys/fs/cgroup/memory.events", encoding="ascii") as events:
            for line in events:
                name, _, value = line.partition(" ")
                if name == "oom_kill":
                    return int(value)
    except OSError:
        pass
    return None


class Capped:
    """Drains a pipe to the end, keeping at most `limit` bytes; `over` says whether there was more."""

    def __init__(self, stream, limit, on_over=None):
        self.chunks, self.size, self.over, self.limit, self.on_over = [], 0, False, limit, on_over
        self.thread = threading.Thread(target=self.read, args=(stream,), daemon=True)
        self.thread.start()

    def read(self, stream):
        while True:
            chunk = stream.read1(65536) if hasattr(stream, "read1") else stream.read(65536)
            if not chunk:
                break
            room = self.limit - self.size
            if room > 0:
                self.chunks.append(chunk[:room])
                self.size += min(room, len(chunk))
            if len(chunk) > room and not self.over:
                self.over = True
                if self.on_over:
                    self.on_over()
        stream.close()

    def text(self):
        # A descendant that left the process group could hold the pipe open; the runner's own deadline ends the container.
        self.thread.join(timeout=2)
        return b"".join(self.chunks).decode("utf-8", "replace")


def execute(command, stdin, timeout_ms, stdout_limit, result_limit, with_results):
    """Runs one command as nobody and measures it; never raises for anything the program does."""
    read_fd = None
    if with_results:
        # fd 3 is held open on /dev/null between runs, so the pipe never lands on it.
        read_fd, write_fd = os.pipe()
        os.dup2(write_fd, 3)
        os.close(write_fd)
    oom_before = oom_kills()
    started = time.monotonic()
    process = subprocess.Popen(
        command, cwd=WORK, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        pass_fds=(3,) if with_results else (), user=NOBODY, group=NOBODY, extra_groups=[], start_new_session=True,
        preexec_fn=limit_child,
    )
    if with_results:
        os.dup2(RESERVED, 3)
    killed = {"reason": None}

    def kill(reason):
        if killed["reason"] is None:
            killed["reason"] = reason
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def feed():
        try:
            process.stdin.write(stdin.encode("utf-8"))
        except (BrokenPipeError, OSError):
            pass
        try:
            process.stdin.close()
        except (BrokenPipeError, OSError):
            pass

    threading.Thread(target=feed, daemon=True).start()
    stdout = Capped(process.stdout, stdout_limit, lambda: kill("output_limit"))
    stderr = Capped(process.stderr, STDERR_LIMIT)
    results = Capped(os.fdopen(read_fd, "rb", buffering=0), result_limit, lambda: kill("output_limit")) if with_results else None
    timer = threading.Timer(timeout_ms / 1000, lambda: kill("timeout"))
    timer.start()
    _, status, usage = os.wait4(process.pid, 0)
    wall_ms = (time.monotonic() - started) * 1000
    timer.cancel()
    process.returncode = os.waitstatus_to_exitcode(status)
    # Anything the program left running in its group goes with it, so the pipes close.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    report = {
        "stdout": stdout.text(), "stderr": stderr.text(), "result": results.text() if results else "",
        "wallMs": round(wall_ms, 2), "cpuMs": round((usage.ru_utime + usage.ru_stime) * 1000, 2), "maxRssKb": usage.ru_maxrss,
        "exitCode": process.returncode if process.returncode >= 0 else None,
        "signal": signal.Signals(-process.returncode).name if process.returncode < 0 else None,
    }
    oom_after = oom_kills()
    if killed["reason"]:
        report["status"] = killed["reason"]
    elif oom_before is not None and oom_after is not None and oom_after > oom_before:
        report["status"] = "memory"
    elif process.returncode != 0:
        report["status"] = "runtime_error"
    else:
        report["status"] = "ok"
    return report


def main():
    # The envelope follows a marker: the Docker client can put its attach request's own body on stdin ahead of it.
    raw = sys.stdin.buffer.read().decode("utf-8")
    envelope = json.loads(raw[raw.index(ENVELOPE_MARKER) + len(ENVELOPE_MARKER):])
    language = envelope["language"]
    memory_mb = int(envelope.get("memoryMb", 512))
    compile_command, run_command = commands(language, memory_mb)
    os.makedirs(WORK, exist_ok=True)
    os.chmod(WORK, 0o777)
    for name, content in envelope["files"].items():
        if "/" in name or name.startswith("."):
            raise ValueError("file names are plain")
        with open(os.path.join(WORK, name), "w", encoding="utf-8") as handle:
            handle.write(content)
        os.chmod(os.path.join(WORK, name), 0o644)
    report = {"compile": None, "runs": []}
    if compile_command:
        compiled = execute(compile_command, "", int(envelope.get("compileTimeoutMs", 20_000)), COMPILE_OUTPUT_LIMIT, 0, False)
        ok = compiled["status"] == "ok"
        report["compile"] = {"ok": ok, "status": compiled["status"], "output": (compiled["stderr"] or compiled["stdout"])[:COMPILE_OUTPUT_LIMIT], "ms": compiled["wallMs"]}
        if not ok:
            print(json.dumps(report))
            return
    for run in envelope["runs"]:
        report["runs"].append(execute(run_command, run.get("stdin", ""), int(run["timeoutMs"]), int(envelope.get("stdoutLimit", 65_536)), int(envelope.get("resultLimit", 16 << 20)), True))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
