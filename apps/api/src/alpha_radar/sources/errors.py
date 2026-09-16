from typing import Literal

ErrorKind = Literal[
    "temporary_source_error",
    "rate_limited",
    "invalid_payload",
    "parser_error",
    "document_not_found",
    "policy_restricted",
]


class SourceError(Exception):
    def __init__(self, kind: ErrorKind, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.retry_after = retry_after
