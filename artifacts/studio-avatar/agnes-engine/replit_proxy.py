"""Adapt Agnes routes to the artifact service path used by Replit's proxy."""

from server import app as agnes_app
from starlette.types import ASGIApp, Receive, Scope, Send


class StripArtifactPrefix:
    def __init__(self, application: ASGIApp) -> None:
        self.application = application

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in {"http", "websocket"}:
            path = scope.get("path", "")
            while path == "/agnes" or path.startswith("/agnes/"):
                path = path[len("/agnes") :] or "/"
            scope["path"] = path
            scope["raw_path"] = path.encode("utf-8")
            scope["root_path"] = ""

        await self.application(scope, receive, send)


app = StripArtifactPrefix(agnes_app)