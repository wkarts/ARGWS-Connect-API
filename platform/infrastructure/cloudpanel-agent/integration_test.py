"""CI-only: exercise the reconciler against an actual disposable NGINX proxy.

No access to CloudPanel, a real host filesystem, Cloudflare or an external CA.
The vendor-specific certificate installer is covered by isolated tests, not this test.
"""
from __future__ import annotations

import importlib.util
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
spec = importlib.util.spec_from_file_location('cloudpanel_nginx_integration', ROOT/'service.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class EchoHost(BaseHTTPRequestHandler):
    def do_GET(self):
        body = self.headers.get('Host', '').encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    with tempfile.TemporaryDirectory(prefix='connect-nginx-ci-') as temporary:
        root = Path(temporary)
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), EchoHost)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True)
        thread.start()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        vhost = root/'proxy.conf'
        vhost.write_text(f'''server {{
    listen 127.0.0.1:{port};
    server_name connect.example.test;
    location / {{
        proxy_set_header Host connect.example.test;
        proxy_pass http://127.0.0.1:{upstream.server_port};
    }}
}}
''')
        config = root/'nginx.conf'
        config.write_text(f'''pid {root/'nginx.pid'};
error_log {root/'error.log'};
events {{}}
http {{
    access_log off;
    client_body_temp_path {root/'client_temp'};
    proxy_temp_path {root/'proxy_temp'};
    fastcgi_temp_path {root/'fastcgi_temp'};
    uwsgi_temp_path {root/'uwsgi_temp'};
    scgi_temp_path {root/'scgi_temp'};
    include {vhost};
}}
''')
        def host_run(*args):
            assert args[0] == 'nginx'
            return subprocess.run(['nginx', '-p', str(root), '-c', str(config), *args[1:]],
                                  capture_output=True, check=True, timeout=10)
        agent.host_run = host_run
        process_started = False
        try:
            host_run('nginx', '-t')
            host_run('nginx')
            process_started = True
            aliases = ['connect.example.test', '*.connect.example.test', 'd.control.connect.example.test']
            result = agent.reconcile_proxy(vhost.read_text(), aliases[0], aliases)
            agent.apply_vhost(vhost, result)
            assert agent.reconcile_proxy(result, aliases[0], aliases) == result
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for hostname in ('demo.connect.example.test', 'customer.connect.example.test', aliases[2]):
                for attempt in range(30):
                    request = urllib.request.Request(f'http://127.0.0.1:{port}/', headers={'Host': hostname})
                    with opener.open(request, timeout=2) as response:
                        received = response.read().decode()
                    if received == hostname:
                        break
                    time.sleep(0.1)
                else:
                    raise AssertionError('Reverse proxy lost the original Host')
            before = vhost.read_bytes()
            try:
                agent.apply_vhost(vhost, 'invalid_nginx_directive;')
            except subprocess.CalledProcessError:
                pass
            else:
                raise AssertionError('Invalid NGINX configuration was accepted')
            assert vhost.read_bytes() == before
            host_run('nginx', '-t')
            print('PASS: actual NGINX wildcard aliases, original Host, idempotency and rollback')
        finally:
            if process_started:
                host_run('nginx', '-s', 'quit')
                for _ in range(30):
                    if not (root/'nginx.pid').exists():
                        break
                    time.sleep(0.1)
            upstream.shutdown()
            upstream.server_close()


if __name__ == '__main__':
    main()
