import socket, threading, time, urllib.request, traceback, os
from http.server import ThreadingHTTPServer
import server as bgm

APP_VERSION = '1.0.1'
ENGINE_VERSION = '0.6.65'

def find_port(start=8545,end=8565):
    for port in range(start,end+1):
        with socket.socket() as s:
            try:
                s.bind(('127.0.0.1',port)); return port
            except OSError:
                pass
    raise RuntimeError('BGM Coin Pro icin bos yerel port bulunamadi.')

def wait_ready(url, timeout=20):
    end=time.time()+timeout
    while time.time()<end:
        try:
            with urllib.request.urlopen(url,timeout=1.5) as r:
                if r.status < 500: return True
        except Exception:
            time.sleep(.2)
    return False

def main():
    try:
        import webview
        port=find_port()
        httpd=ThreadingHTTPServer(('127.0.0.1',port),bgm.Handler)
        threading.Thread(target=httpd.serve_forever,daemon=True).start()
        health=f'http://127.0.0.1:{port}/api/health'
        if not wait_ready(health):
            raise RuntimeError('BGM veri sunucusu baslatilamadi.')
        url=f'http://127.0.0.1:{port}/?desktop=1&v=101'
        webview.create_window('BGM Coin Pro', url, width=1500, height=940, min_size=(1100,700), resizable=True, text_select=True)
        data_dir=os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'BGM Coin Pro', 'WebView')
        os.makedirs(data_dir,exist_ok=True)
        try:
            webview.start(debug=False, private_mode=False, storage_path=data_dir)
        finally:
            httpd.shutdown();httpd.server_close()
    except Exception as exc:
        # Native Windows error dialog; no CMD window required.
        try:
            import ctypes
            msg=f'BGM Coin Pro acilamadi.\n\n{exc}\n\n{traceback.format_exc()[-1200:]}'
            ctypes.windll.user32.MessageBoxW(0,msg,'BGM Coin Pro',0x10)
        except Exception:
            pass
        raise

if __name__=='__main__':
    main()
