#!/usr/bin/env python3
"""Sample actual Android process memory; no estimated or fabricated readings.

Run with the app open, then load a model and run the cases on the phone.
The output stays local. It contains dumpsys memory numbers, not learner data.
"""
import argparse
import json
import re
import shutil
import subprocess
import time
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--serial', help='ADB device serial when more than one device is connected')
    ap.add_argument('--package', default='com.onesmarter.localmind.spike')
    ap.add_argument('--samples', type=int, default=60)
    ap.add_argument('--interval', type=float, default=2.0)
    ap.add_argument('--output', type=Path, default=Path('memory-measurements.jsonl'))
    args = ap.parse_args()
    if not shutil.which('adb'):
        ap.error('adb was not found. Install Android platform-tools and add adb to PATH.')
    if not re.fullmatch(r'[a-zA-Z][\w]*(?:\.[\w]+)+', args.package):
        ap.error('Invalid Android package identifier')
    if not 1 <= args.samples <= 3600 or args.interval < 0.5:
        ap.error('Use 1–3600 samples and an interval of at least 0.5 seconds')
    base = ['adb'] + (['-s', args.serial] if args.serial else [])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        for i in range(args.samples):
            try:
                result = subprocess.run(base + ['shell', 'dumpsys', 'meminfo', args.package], capture_output=True, text=True, timeout=15, check=True)
                match = re.search(r'TOTAL PSS:\s*(\d+)', result.stdout)
                if match is None:
                    match = re.search(r'^\s*TOTAL\s+(\d+)', result.stdout, re.MULTILINE)
                record = {'sample': i + 1, 'utc_epoch_seconds': time.time(),
                          'process_pss_kib': int(match.group(1)) if match else None,
                          'status': 'measured' if match else 'process_missing_or_format_unrecognized',
                          'raw_dumpsys': result.stdout}
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
                record = {'sample': i + 1, 'utc_epoch_seconds': time.time(), 'process_pss_kib': None, 'status': type(exc).__name__}
            stream.write(json.dumps(record) + '\n'); stream.flush()
            print(f"Sample {i + 1}: {record['process_pss_kib']} KiB ({record['status']})")
            if i + 1 < args.samples:
                time.sleep(args.interval)
    print(f'Saved {args.output}; PSS is process memory, not total free-device RAM.')


if __name__ == '__main__':
    main()
