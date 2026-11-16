# The image every untrusted program runs in: one fresh container per execution, started by the runner with no network,
# a read-only root, a small writable /tmp and hard CPU, memory and process limits. `entry.py` is the only trusted code in it.
FROM node:24.11.1-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 g++ openjdk-17-jdk-headless \
  && rm -rf /var/lib/apt/lists/*

# Every C++ program includes <bits/stdc++.h>; precompiled with the flags programs are built with, it compiles in a fraction of the time.
RUN header=/usr/include/x86_64-linux-gnu/c++/12/bits/stdc++.h \
  && g++ -O2 -std=gnu++17 -x c++-header "$header" -o "$header.gch"

COPY entry.py /sandbox/entry.py
WORKDIR /tmp
ENTRYPOINT ["python3", "-I", "/sandbox/entry.py"]
