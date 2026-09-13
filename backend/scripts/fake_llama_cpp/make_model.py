"""Write a placeholder .gguf (valid header, 64 MB) for use with the fake llama_cpp module."""
import sys
from pathlib import Path

target = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/fake.gguf")
target.parent.mkdir(parents=True, exist_ok=True)
with open(target, "wb") as fh:
    fh.write(b"GGUF" + b"\0" * (64 * (1 << 20) - 4))
print(f"wrote {target}")
