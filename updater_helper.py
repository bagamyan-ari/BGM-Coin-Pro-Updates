import os, sys, time, subprocess
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000

def log(msg):
    try:
        p = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'BGM Coin Pro' / 'updater.log'
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open('a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')
    except Exception:
        pass

def bgm_pids():
    """Return only BGM Coin Pro.exe PIDs. Never kill child trees: updater is a child."""
    try:
        out = subprocess.check_output(
            ['tasklist', '/FI', 'IMAGENAME eq BGM Coin Pro.exe', '/FO', 'CSV', '/NH'],
            text=True, creationflags=CREATE_NO_WINDOW, errors='ignore'
        )
        pids = []
        import csv, io
        for row in csv.reader(io.StringIO(out)):
            if len(row) >= 2 and row[0].lower() == 'bgm coin pro.exe':
                try: pids.append(int(row[1]))
                except ValueError: pass
        return pids
    except Exception as e:
        log(f'tasklist error={e!r}')
        return []

def kill_bgm_only():
    # IMPORTANT: no /T. /T killed the separately launched updater because it was
    # still a descendant of the PyInstaller app process.
    pids = bgm_pids()
    log(f'bgm pids before kill={pids}')
    for pid in pids:
        try:
            subprocess.run(['taskkill', '/F', '/PID', str(pid)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW, timeout=5)
        except Exception as e:
            log(f'kill pid={pid} error={e!r}')
    return pids

def main():
    if len(sys.argv) < 3:
        log('ERROR: missing arguments')
        return 2
    setup = Path(sys.argv[1])
    app = Path(sys.argv[2])
    log(f'helper start pid={os.getpid()} setup={setup} app={app}')
    time.sleep(1.0)

    for _ in range(5):
        pids = bgm_pids()
        if not pids:
            break
        kill_bgm_only()
        time.sleep(0.8)

    remaining = bgm_pids()
    log(f'bgm pids after kill={remaining}')
    if remaining:
        log('ERROR: BGM process still running')
        return 3
    if not setup.exists():
        log('ERROR: setup missing')
        return 4

    log('launch installer')
    try:
        p = subprocess.Popen([str(setup), '/CLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS'], shell=False)
        rc = p.wait()
        log(f'installer exit={rc}')
    except Exception as e:
        log(f'ERROR: installer launch failed {e!r}')
        return 5

    if rc == 0 and app.exists():
        time.sleep(1.5)
        try:
            subprocess.Popen([str(app)], cwd=str(app.parent), shell=False)
            log('new app launched')
        except Exception as e:
            log(f'ERROR: relaunch failed {e!r}')
            return 6
    return rc

if __name__ == '__main__':
    raise SystemExit(main())
