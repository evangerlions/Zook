"""Build assets for a URL prefix; keep internal API routes unchanged."""
import re
from pathlib import Path


def validate_prefix(value):
    if value and not re.fullmatch(r'/[a-zA-Z0-9_-]+', value):
        raise ValueError('GROW_BASE_PATH must be empty or one URL path segment.')
    return value


def rewrite_asset(text, prefix):
    validate_prefix(prefix)
    if not prefix:
        return text
    text = re.sub(r'''(["'`])/(api|static|login)(?=[/\?\#"'`])''',
                  lambda m: m[1] + prefix + '/' + m[2], text)
    text = text.replace("location.replace('/'+", "location.replace('" + prefix + "/'+")
    text = text.replace('href="/"', 'href="' + prefix + '/"')
    return text


def prepare(directory, prefix):
    for path in Path(directory).iterdir():
        if path.suffix in ('.html', '.js', '.css'):
            path.write_text(rewrite_asset(path.read_text(), prefix))


class PrefixApp:
    """Strip the external prefix before auth, preserve streaming response bodies."""
    def __init__(self, app, prefix):
        self.app, self.prefix = app, validate_prefix(prefix)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not self.prefix:
            return await self.app(scope, receive, send)
        path = scope['path']
        if path == self.prefix:
            query = scope.get('query_string', b'')
            location = (self.prefix + '/').encode() + (b'?' + query if query else b'')
            await send({'type': 'http.response.start', 'status': 308,
                        'headers': [(b'location', location)]})
            return await send({'type': 'http.response.body', 'body': b''})
        if path.startswith(self.prefix + '/'):
            scope = dict(scope, path=path[len(self.prefix):], root_path='')
            scope['raw_path'] = scope.get('raw_path', path.encode())[len(self.prefix):]

        async def prefixed_send(message):
            if message['type'] == 'http.response.start':
                headers = []
                for name, value in message.get('headers', []):
                    if name.lower() == b'location' and value.startswith(b'/') and not value.startswith(b'//'):
                        value = self.prefix.encode() + value
                    if name.lower() == b'set-cookie':
                        value = re.sub(rb'(?i)(;\s*path=)/(?=;|$)',
                                       lambda m: m[1] + self.prefix.encode() + b'/', value)
                    headers.append((name, value))
                message = dict(message, headers=headers)
            await send(message)
        await self.app(scope, receive, prefixed_send)


if __name__ == '__main__':
    import sys
    prepare(Path(__file__).parent / 'static', sys.argv[1])
