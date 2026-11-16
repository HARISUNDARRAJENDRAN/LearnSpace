import type { CodingLanguage, Signature } from "@learnspace/shared/coding";
import { cppType, javaType } from "@learnspace/shared/coding-code";

/**
 * The per-language test harness. Each one reads the cases as one JSON array of argument lists on stdin, calls the learner's
 * function once per case on a fresh instance, and writes one JSON line per case to fd 3:
 *   {"i": 0, "ok": true, "v": <returned value>, "ms": 0.4}  or  {"i": 0, "ok": false, "e": "IndexError", "m": "...", "line": 7}
 * A first line {"ce": "..."} means the learner's code did not compile; {"setup": {...}} that it failed before any case ran.
 * Before each case it prints CASE_MARKER(i) on stdout, so whatever the learner prints is attributed to its case. Expected
 * outputs never enter the sandbox: the harness only reports what the code returned.
 */
export const caseMarker = (index: number) => `\u001e${index}\u001e`;

// A JSON string literal is a valid string literal in Python and JavaScript, so the learner's code travels as data.
const literal = (text: string) => JSON.stringify(text);

function pythonHarness(signature: Signature, code: string): string {
  return `import json, os, sys, threading, time, traceback

SOURCE = ${literal(code)}
PRELUDE = "from typing import *\\nimport collections, heapq, bisect, math, itertools, functools, string, re\\nfrom collections import Counter, defaultdict, deque, OrderedDict\\nfrom functools import lru_cache, cache, reduce\\n"


def where(error):
    frames = [frame for frame in traceback.extract_tb(error.__traceback__) if frame.filename == "solution.py"]
    return frames[-1].lineno if frames else None


def failure(error):
    return {"e": type(error).__name__, "m": str(error)[:500], "line": where(error)}


def main():
    out = os.fdopen(3, "w")
    namespace = {"__name__": "solution"}
    exec(PRELUDE, namespace)
    try:
        compiled = compile(SOURCE, "solution.py", "exec")
    except SyntaxError as error:
        out.write(json.dumps({"ce": f"Line {error.lineno}: {error.msg}"}) + "\\n")
        out.flush()
        return
    try:
        exec(compiled, namespace)
        method = getattr(namespace["Solution"], ${literal(signature.functionName)})
    except BaseException as error:
        out.write(json.dumps({"setup": failure(error)}) + "\\n")
        out.flush()
        return
    cases = json.loads(sys.stdin.read())
    for index, args in enumerate(cases):
        sys.stdout.write("\\x1e%d\\x1e\\n" % index)
        sys.stdout.flush()
        started = time.perf_counter()
        try:
            value = method(namespace["Solution"](), *args)
            elapsed = (time.perf_counter() - started) * 1000
            sys.stdout.flush()
            try:
                line = json.dumps({"i": index, "ok": True, "v": value, "ms": elapsed})
            except (TypeError, ValueError):
                line = json.dumps({"i": index, "ok": False, "e": "TypeError", "m": "returned a value that is not " + ${literal(signature.returns)}, "line": None})
        except BaseException as error:
            sys.stdout.flush()
            line = json.dumps({"i": index, "ok": False, **failure(error)})
        out.write(line + "\\n")
        out.flush()


sys.setrecursionlimit(1 << 20)
threading.stack_size(256 << 20)
worker = threading.Thread(target=main)
worker.start()
worker.join()
`;
}

function jsHarness(signature: Signature, code: string, typescript: boolean): string {
  const source = typescript ? `require("node:module").stripTypeScriptTypes(${literal(code)}, { mode: "strip" })` : literal(code);
  return `const __fs = require("node:fs");
const __vm = require("node:vm");
globalThis.require = require;
const __line = (error) => { const match = /solution\\.js:(\\d+)/.exec(String(error && error.stack)); return match ? Number(match[1]) : null; };
const __write = (value) => __fs.writeSync(3, JSON.stringify(value) + "\\n");
let __fn;
try {
  __vm.runInThisContext(${source}, { filename: "solution.js" });
} catch (error) {
  if (error instanceof SyntaxError || (error && error.code === "ERR_INVALID_TYPESCRIPT_SYNTAX")) {
    __write({ ce: String(error.message) + (__line(error) ? " (line " + __line(error) + ")" : "") });
  } else {
    __write({ setup: { e: (error && error.name) || "Error", m: String(error && error.message).slice(0, 500), line: __line(error) } });
  }
  process.exit(0);
}
try {
  __fn = __vm.runInThisContext(${literal(`typeof ${signature.functionName} === "function" ? ${signature.functionName} : undefined`)});
} catch {}
if (typeof __fn !== "function") {
  __write({ setup: { e: "ReferenceError", m: ${literal(`${signature.functionName} is not defined`)}, line: null } });
  process.exit(0);
}
const __cases = JSON.parse(__fs.readFileSync(0, "utf8"));
for (let i = 0; i < __cases.length; i++) {
  process.stdout.write("\\u001e" + i + "\\u001e\\n");
  const started = performance.now();
  let line;
  try {
    const value = __fn(...__cases[i]);
    const ms = performance.now() - started;
    line = JSON.stringify({ i, ok: true, v: value === undefined ? null : value, ms });
  } catch (error) {
    line = JSON.stringify({ i, ok: false, e: (error && error.name) || "Error", m: String(error && error.message !== undefined ? error.message : error).slice(0, 500), line: __line(error) });
  }
  __fs.writeSync(3, line + "\\n");
}
`;
}

const JAVA_PRELUDE = "import java.util.*; import java.util.stream.*; import java.util.function.*; ";

function javaHarness(signature: Signature): string {
  const params = signature.params.map((param, index) => `${javaType(param.type)} a${index} = (${javaType(param.type)}) convert(args.get(${index}), "${param.type}");`).join(" ");
  return `import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class Main {
  static String src; static int pos;
  static void ws() { while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) pos++; }
  static Object parse() {
    ws(); char c = src.charAt(pos);
    if (c == '[') { pos++; List<Object> list = new ArrayList<>(); ws(); if (src.charAt(pos) == ']') { pos++; return list; }
      while (true) { list.add(parse()); ws(); char d = src.charAt(pos++); if (d == ']') break; } return list; }
    if (c == '"') { pos++; StringBuilder sb = new StringBuilder();
      while (true) { char d = src.charAt(pos++); if (d == '"') break;
        if (d == '\\\\') { char e = src.charAt(pos++);
          switch (e) { case 'n': sb.append('\\n'); break; case 't': sb.append('\\t'); break; case 'r': sb.append('\\r'); break; case 'b': sb.append('\\b'); break; case 'f': sb.append('\\f'); break;
            case 'u': sb.append((char) Integer.parseInt(src.substring(pos, pos + 4), 16)); pos += 4; break; default: sb.append(e); } }
        else sb.append(d); }
      return sb.toString(); }
    if (c == 't') { pos += 4; return Boolean.TRUE; } if (c == 'f') { pos += 5; return Boolean.FALSE; } if (c == 'n') { pos += 4; return null; }
    int start = pos; while (pos < src.length() && "+-0123456789.eE".indexOf(src.charAt(pos)) >= 0) pos++;
    String number = src.substring(start, pos);
    if (number.contains(".") || number.contains("e") || number.contains("E")) return Double.parseDouble(number);
    return Long.parseLong(number);
  }
  @SuppressWarnings("unchecked")
  static Object convert(Object value, String type) {
    if (type.endsWith("[]")) {
      String inner = type.substring(0, type.length() - 2); List<Object> list = (List<Object>) value; int n = list.size();
      Object array;
      switch (inner) { case "int": array = new int[n]; break; case "long": array = new long[n]; break; case "double": array = new double[n]; break; case "bool": array = new boolean[n]; break; case "string": array = new String[n]; break;
        case "int[]": array = new int[n][]; break; case "long[]": array = new long[n][]; break; case "double[]": array = new double[n][]; break; case "bool[]": array = new boolean[n][]; break; default: array = new String[n][]; }
      for (int i = 0; i < n; i++) Array.set(array, i, convert(list.get(i), inner));
      return array;
    }
    switch (type) {
      case "int": return (int) (long) (Long) value;
      case "long": return (Long) value;
      case "double": return value instanceof Long ? (double) (Long) value : (Double) value;
      case "bool": return (Boolean) value;
      default: return (String) value;
    }
  }
  static void write(StringBuilder sb, Object value) {
    if (value == null) { sb.append("null"); return; }
    if (value instanceof String) { String s = (String) value; sb.append('"');
      for (int i = 0; i < s.length(); i++) { char c = s.charAt(i);
        if (c == '"' || c == '\\\\') sb.append('\\\\').append(c); else if (c < 0x20) sb.append(String.format("\\\\u%04x", (int) c)); else sb.append(c); }
      sb.append('"'); return; }
    if (value instanceof Double) { double d = (Double) value; if (Double.isNaN(d) || Double.isInfinite(d)) sb.append("null"); else sb.append(d); return; }
    if (value.getClass().isArray()) { sb.append('['); int n = Array.getLength(value); for (int i = 0; i < n; i++) { if (i > 0) sb.append(','); write(sb, Array.get(value, i)); } sb.append(']'); return; }
    sb.append(value);
  }
  static int line(Throwable error) {
    for (StackTraceElement frame : error.getStackTrace()) if ("Solution.java".equals(frame.getFileName())) return frame.getLineNumber();
    return -1;
  }
  static String json(String text) { StringBuilder sb = new StringBuilder(); write(sb, text); return sb.toString(); }
  @SuppressWarnings("unchecked")
  static void run() throws Exception {
    FileDescriptor fd = new FileDescriptor(); Field field = FileDescriptor.class.getDeclaredField("fd"); field.setAccessible(true); field.setInt(fd, 3);
    PrintStream out = new PrintStream(new FileOutputStream(fd), false, "UTF-8");
    src = new String(System.in.readAllBytes(), StandardCharsets.UTF_8); pos = 0;
    List<Object> cases = (List<Object>) parse();
    for (int i = 0; i < cases.size(); i++) {
      List<Object> args = (List<Object>) cases.get(i);
      System.out.print("\\u001e" + i + "\\u001e\\n"); System.out.flush();
      StringBuilder sb = new StringBuilder();
      try {
        ${params}
        long started = System.nanoTime();
        Object value = new Solution().${signature.functionName}(${signature.params.map((_, index) => `a${index}`).join(", ")});
        double ms = (System.nanoTime() - started) / 1e6;
        System.out.flush();
        sb.append("{\\"i\\":").append(i).append(",\\"ok\\":true,\\"v\\":"); write(sb, value); sb.append(",\\"ms\\":").append(ms).append('}');
      } catch (Throwable error) {
        System.out.flush();
        int at = line(error);
        sb.append("{\\"i\\":").append(i).append(",\\"ok\\":false,\\"e\\":").append(json(error.getClass().getSimpleName())).append(",\\"m\\":").append(json(String.valueOf(error.getMessage()))).append(",\\"line\\":").append(at < 0 ? "null" : String.valueOf(at)).append('}');
      }
      out.print(sb.append('\\n')); out.flush();
    }
  }
  public static void main(String[] argv) throws Exception {
    Thread worker = new Thread(null, () -> { try { run(); } catch (Exception error) { throw new RuntimeException(error); } }, "main", 256L << 20);
    worker.start(); worker.join();
  }
}
`;
}

const CPP_HARNESS = `
#line 1 "harness.cpp"
#include <unistd.h>
struct LsValue { int k = 0; long long i = 0; double d = 0; bool b = false; string s; vector<LsValue> a; };
static string LS_SRC; static size_t LS_POS = 0;
static void ls_ws() { while (LS_POS < LS_SRC.size() && isspace((unsigned char) LS_SRC[LS_POS])) LS_POS++; }
static void ls_utf8(string& out, unsigned cp) {
  if (cp < 0x80) out += (char) cp; else if (cp < 0x800) { out += (char) (0xC0 | (cp >> 6)); out += (char) (0x80 | (cp & 0x3F)); }
  else { out += (char) (0xE0 | (cp >> 12)); out += (char) (0x80 | ((cp >> 6) & 0x3F)); out += (char) (0x80 | (cp & 0x3F)); }
}
static LsValue ls_parse() {
  ls_ws(); LsValue v; char c = LS_SRC[LS_POS];
  if (c == '[') { LS_POS++; v.k = 5; ls_ws(); if (LS_SRC[LS_POS] == ']') { LS_POS++; return v; } while (true) { v.a.push_back(ls_parse()); ls_ws(); char d = LS_SRC[LS_POS++]; if (d == ']') break; } return v; }
  if (c == '"') { LS_POS++; v.k = 4; while (true) { char d = LS_SRC[LS_POS++]; if (d == '"') break;
      if (d == '\\\\') { char e = LS_SRC[LS_POS++]; if (e == 'n') v.s += '\\n'; else if (e == 't') v.s += '\\t'; else if (e == 'r') v.s += '\\r'; else if (e == 'b') v.s += '\\b'; else if (e == 'f') v.s += '\\f';
        else if (e == 'u') { ls_utf8(v.s, (unsigned) stoul(LS_SRC.substr(LS_POS, 4), nullptr, 16)); LS_POS += 4; } else v.s += e; }
      else v.s += d; } return v; }
  if (c == 't') { LS_POS += 4; v.k = 3; v.b = true; return v; } if (c == 'f') { LS_POS += 5; v.k = 3; return v; } if (c == 'n') { LS_POS += 4; return v; }
  size_t start = LS_POS; while (LS_POS < LS_SRC.size() && strchr("+-0123456789.eE", LS_SRC[LS_POS])) LS_POS++;
  string number = LS_SRC.substr(start, LS_POS - start);
  if (number.find_first_of(".eE") != string::npos) { v.k = 2; v.d = stod(number); } else { v.k = 1; v.i = stoll(number); }
  return v;
}
static void ls_read(const LsValue& j, int& x) { x = (int) j.i; }
static void ls_read(const LsValue& j, long long& x) { x = j.i; }
static void ls_read(const LsValue& j, double& x) { x = j.k == 1 ? (double) j.i : j.d; }
static void ls_read(const LsValue& j, bool& x) { x = j.b; }
static void ls_read(const LsValue& j, string& x) { x = j.s; }
template <class T> static void ls_read(const LsValue& j, vector<T>& x) { x.resize(j.a.size()); for (size_t i = 0; i < j.a.size(); i++) { T item; ls_read(j.a[i], item); x[i] = item; } }
static void ls_write(string& o, int v) { o += to_string(v); }
static void ls_write(string& o, long long v) { o += to_string(v); }
static void ls_write(string& o, double v) { if (!isfinite(v)) { o += "null"; return; } char buffer[40]; snprintf(buffer, sizeof buffer, "%.17g", v); o += buffer; }
static void ls_write(string& o, bool v) { o += v ? "true" : "false"; }
static void ls_write(string& o, const string& s) {
  o += '"'; for (unsigned char c : s) { if (c == '"' || c == '\\\\') { o += '\\\\'; o += (char) c; } else if (c < 0x20) { char buffer[8]; snprintf(buffer, sizeof buffer, "\\\\u%04x", c); o += buffer; } else o += (char) c; } o += '"';
}
template <class T> static void ls_write(string& o, const vector<T>& v) { o += '['; for (size_t i = 0; i < v.size(); i++) { if (i) o += ','; T item = v[i]; ls_write(o, item); } o += ']'; }
int main() {
  FILE* results = fdopen(3, "w");
  { stringstream buffer; buffer << cin.rdbuf(); LS_SRC = buffer.str(); }
  LsValue cases = ls_parse();
  for (size_t i = 0; i < cases.a.size(); i++) {
    const LsValue& c = cases.a[i];
    fflush(stdout); cout.flush(); printf("\\x1e%zu\\x1e\\n", i); fflush(stdout);
    string line = "{\\"i\\":" + to_string(i) + ",";
    try {
      __ARGS__
      auto started = chrono::steady_clock::now();
      Solution solution;
      auto value = solution.__NAME__(__CALL__);
      double ms = chrono::duration<double, milli>(chrono::steady_clock::now() - started).count();
      cout.flush(); fflush(stdout);
      line += "\\"ok\\":true,\\"v\\":"; ls_write(line, value); line += ",\\"ms\\":"; ls_write(line, ms); line += "}";
    } catch (const exception& error) {
      line += "\\"ok\\":false,\\"e\\":\\"exception\\",\\"m\\":"; ls_write(line, string(error.what())); line += ",\\"line\\":null}";
    } catch (...) {
      line += "\\"ok\\":false,\\"e\\":\\"exception\\",\\"m\\":\\"unknown exception\\",\\"line\\":null}";
    }
    fputs((line + "\\n").c_str(), results); fflush(results);
  }
  return 0;
}
`;

/** The files the sandbox builds for a learner's code in a language. */
export function harnessFiles(signature: Signature, language: CodingLanguage, code: string): Record<string, string> {
  switch (language) {
    case "python":
      return { "main.py": pythonHarness(signature, code) };
    case "javascript":
      return { "main.js": jsHarness(signature, code, false) };
    case "typescript":
      return { "main.ts": jsHarness(signature, code, true) };
    case "java":
      // The prelude shares the learner's first line, so line numbers in errors stay theirs.
      return { "Main.java": javaHarness(signature), "Solution.java": JAVA_PRELUDE + code };
    case "cpp": {
      const args = signature.params.map((param, index) => `${cppType(param.type)} a${index}; ls_read(c.a[${index}], a${index});`).join(" ");
      const harness = CPP_HARNESS.replace("__ARGS__", args).replace("__NAME__", signature.functionName).replace("__CALL__", signature.params.map((_, index) => `a${index}`).join(", "));
      return { "main.cpp": `#include <bits/stdc++.h>\nusing namespace std;\n#line 1 "solution.cpp"\n${code}\n${harness}` };
    }
  }
}

/** A Python reference (`def solve(...)`) dressed as a learner's solution, so the harness grades it like any submission. */
export function referenceAsSolution(signature: Signature, reference: string): string {
  return `${reference}\n\n\nclass Solution:\n    def ${signature.functionName}(self, *args):\n        return solve(*args)\n`;
}
