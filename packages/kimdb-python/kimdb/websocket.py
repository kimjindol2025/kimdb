"""
KimDB WebSocket Client - Real-time synchronization
"""

import json
import threading
import time
from typing import Any, Callable, Dict, Optional
from websocket import WebSocketApp, WebSocketException


class KimDBWebSocket:
    """WebSocket client for real-time KimDB synchronization"""

    def __init__(self, url: str, node_id: Optional[str] = None):
        """
        Initialize WebSocket client

        Args:
            url: WebSocket URL (e.g., 'ws://localhost:40000/ws')
            node_id: Optional client node ID (auto-generated if not provided)
        """
        self.url = url
        self.node_id = node_id or f"client-{int(time.time() * 1000)}"
        self.ws = None
        self.connected = False
        self.callbacks: Dict[str, list] = {
            'connected': [],
            'disconnected': [],
            'subscribed': [],
            'doc.synced': [],
            'doc.updated': [],
            'presence.changed': [],
            'pong': [],
            'error': [],
        }
        self.heartbeat_thread: Optional[threading.Thread] = None
        self.lock = threading.Lock()

    def on(self, event: str, callback: Callable[[Dict[str, Any]], None]) -> None:
        """
        Register event listener

        Args:
            event: Event name
            callback: Callback function
        """
        if event not in self.callbacks:
            self.callbacks[event] = []

        self.callbacks[event].append(callback)

    def _emit(self, event: str, data: Dict[str, Any]) -> None:
        """Emit event to all listeners"""
        if event in self.callbacks:
            for callback in self.callbacks[event]:
                try:
                    callback(data)
                except Exception as error:
                    print(f"[KimDB] Callback error: {error}")

    def _on_open(self, ws: WebSocketApp) -> None:
        """WebSocket connection opened"""
        with self.lock:
            self.connected = True
        print(f"[KimDB] WebSocket connected (nodeId: {self.node_id})")
        self._emit('connected', {})
        self._start_heartbeat()

    def _on_message(self, ws: WebSocketApp, message: str) -> None:
        """Handle incoming message"""
        try:
            data = json.loads(message)
            self._handle_message(data)
        except json.JSONDecodeError as error:
            print(f"[KimDB] Failed to parse message: {error}")

    def _handle_message(self, message: Dict[str, Any]) -> None:
        """Process incoming WebSocket message"""
        msg_type = message.get('type')

        if msg_type == 'subscribed':
            self._emit('subscribed', {'collection': message.get('collection')})

        elif msg_type == 'doc.synced':
            self._emit('doc.synced', {
                'collection': message.get('collection'),
                'docId': message.get('docId'),
                'data': message.get('data'),
                'version': message.get('_version'),
            })

        elif msg_type == 'doc.updated':
            self._emit('doc.updated', {
                'docId': message.get('docId'),
                'success': message.get('success'),
                'version': message.get('_version'),
            })

        elif msg_type == 'presence.changed':
            self._emit('presence.changed', {
                'docId': message.get('docId'),
                'nodeId': message.get('nodeId'),
                'presence': message.get('presence'),
            })

        elif msg_type == 'pong':
            self._emit('pong', {'timestamp': message.get('timestamp')})

        elif msg_type == 'error':
            error = message.get('error', 'Unknown error')
            self._emit('error', {'message': error})

    def _on_error(self, ws: WebSocketApp, error: Exception) -> None:
        """WebSocket error occurred"""
        print(f"[KimDB] WebSocket error: {error}")
        self._emit('error', {'message': str(error)})

    def _on_close(self, ws: WebSocketApp, close_status_code, close_msg) -> None:
        """WebSocket connection closed"""
        with self.lock:
            self.connected = False
        print("[KimDB] WebSocket disconnected")
        self._emit('disconnected', {})
        self._stop_heartbeat()

    def connect(self, timeout: int = 10) -> None:
        """
        Connect to WebSocket server

        Args:
            timeout: Connection timeout in seconds
        """
        try:
            self.ws = WebSocketApp(
                self.url,
                on_open=self._on_open,
                on_message=self._on_message,
                on_error=self._on_error,
                on_close=self._on_close,
            )

            # Run in background thread
            thread = threading.Thread(target=self.ws.run_forever)
            thread.daemon = True
            thread.start()

            # Wait for connection
            start_time = time.time()
            while not self.connected and (time.time() - start_time) < timeout:
                time.sleep(0.1)

            if not self.connected:
                raise TimeoutError(f"Connection timeout after {timeout} seconds")

        except Exception as error:
            raise ConnectionError(f"Failed to connect: {error}")

    def subscribe(self, collection: str) -> None:
        """
        Subscribe to collection updates

        Args:
            collection: Collection name
        """
        if not self.connected:
            raise RuntimeError("WebSocket not connected")

        message = {'type': 'subscribe', 'collection': collection}
        self.ws.send(json.dumps(message))

    def subscribe_document(self, collection: str, doc_id: str) -> None:
        """
        Subscribe to specific document

        Args:
            collection: Collection name
            doc_id: Document ID
        """
        if not self.connected:
            raise RuntimeError("WebSocket not connected")

        message = {
            'type': 'doc.subscribe',
            'collection': collection,
            'docId': doc_id,
        }
        self.ws.send(json.dumps(message))

    def update_document(
        self,
        collection: str,
        doc_id: str,
        data: Dict[str, Any],
    ) -> None:
        """
        Update document with CRDT sync

        Args:
            collection: Collection name
            doc_id: Document ID
            data: Document data to update
        """
        if not self.connected:
            raise RuntimeError("WebSocket not connected")

        message = {
            'type': 'doc.update',
            'collection': collection,
            'docId': doc_id,
            'data': data,
            'nodeId': self.node_id,
        }
        self.ws.send(json.dumps(message))

    def undo(self, collection: str, doc_id: str) -> None:
        """
        Undo last operation

        Args:
            collection: Collection name
            doc_id: Document ID
        """
        if not self.connected:
            raise RuntimeError("WebSocket not connected")

        message = {
            'type': 'doc.undo',
            'collection': collection,
            'docId': doc_id,
            'nodeId': self.node_id,
        }
        self.ws.send(json.dumps(message))

    def redo(self, collection: str, doc_id: str) -> None:
        """
        Redo operation

        Args:
            collection: Collection name
            doc_id: Document ID
        """
        if not self.connected:
            raise RuntimeError("WebSocket not connected")

        message = {
            'type': 'doc.redo',
            'collection': collection,
            'docId': doc_id,
            'nodeId': self.node_id,
        }
        self.ws.send(json.dumps(message))

    def update_presence(
        self,
        collection: str,
        doc_id: str,
        presence: Dict[str, Any],
    ) -> None:
        """
        Update presence information

        Args:
            collection: Collection name
            doc_id: Document ID
            presence: Presence data
        """
        if not self.connected:
            raise RuntimeError("WebSocket not connected")

        message = {
            'type': 'presence.update',
            'collection': collection,
            'docId': doc_id,
            'nodeId': self.node_id,
            'presence': presence,
        }
        self.ws.send(json.dumps(message))

    def _ping(self) -> None:
        """Send heartbeat ping"""
        if self.connected:
            try:
                self.ws.send(json.dumps({'type': 'ping'}))
            except Exception as error:
                print(f"[KimDB] Ping failed: {error}")

    def _start_heartbeat(self) -> None:
        """Start heartbeat thread"""
        def heartbeat_loop():
            while self.connected:
                time.sleep(30)
                self._ping()

        self.heartbeat_thread = threading.Thread(target=heartbeat_loop)
        self.heartbeat_thread.daemon = True
        self.heartbeat_thread.start()

    def _stop_heartbeat(self) -> None:
        """Stop heartbeat thread"""
        # Thread will exit automatically when self.connected becomes False
        pass

    def disconnect(self) -> None:
        """Disconnect from server"""
        with self.lock:
            self.connected = False

        if self.ws:
            self.ws.close()
            self.ws = None

    def is_connected(self) -> bool:
        """Check connection status"""
        return self.connected
