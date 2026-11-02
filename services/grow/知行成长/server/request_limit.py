"""Queue database-backed requests before authentication opens a connection."""
import asyncio
import time


class RequestConcurrencyLimit:
    def __init__(self, app, limit=4):
        self.app = app
        # One request can hold an advisory-lock connection and a working connection.
        # Leave headroom in the shared 15-session database pool for background work.
        self.slots = asyncio.Semaphore(limit)
        # Historical lists/reminder polls must not occupy every DB request
        # slot while a new page is trying to authenticate and read its workspace.
        # The total bound stays unchanged; this reserves one foreground slot.
        self.background = asyncio.Semaphore(max(1, limit-1))

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if scope['type'] != 'http' or path in ('/api/health', '/login') or path.startswith('/static/'):
            await self.app(scope, receive, send)
            return
        started = time.monotonic()
        async def run():
            async with self.slots:
                queued = (time.monotonic()-started)*1000
                async def timed_send(message):
                    if message['type'] == 'http.response.start':
                        message = dict(message, headers=[*message.get('headers', []),
                            (b'server-timing', f'request_queue;dur={queued:.1f}'.encode())])
                    await send(message)
                await self.app(scope, receive, timed_send)
        interactive = (scope.get('method') == 'GET' and path.startswith('/api/investments/')
            and (b'x-investment-interactive', b'1') in scope.get('headers', []))
        if interactive or path in ('/', '/api/auth/me', '/api/investments/workspace'):
            await run()
        else:
            async with self.background:
                await run()
