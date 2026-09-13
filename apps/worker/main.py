"""Celery entry point for the Alpha Radar background worker."""

from alpha_radar.worker import app

__all__ = ["app"]
