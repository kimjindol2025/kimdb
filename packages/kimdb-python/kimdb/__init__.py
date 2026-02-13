"""
KimDB Python Client - High-performance document database client
"""

from .client import KimDBClient
from .websocket import KimDBWebSocket

__version__ = "1.0.0"
__all__ = ["KimDBClient", "KimDBWebSocket"]
