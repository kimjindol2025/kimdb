/**
 * KimDB WebSocket Client - Real-time synchronization
 * @module @kimdb/client/websocket
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface SubscribeMessage {
  type: 'subscribe';
  collection: string;
}

export interface DocSubscribeMessage {
  type: 'doc.subscribe';
  collection: string;
  docId: string;
}

export interface DocUpdateMessage {
  type: 'doc.update';
  collection: string;
  docId: string;
  data: Record<string, unknown>;
  nodeId: string;
}

export interface DocUndoMessage {
  type: 'doc.undo';
  collection: string;
  docId: string;
  nodeId: string;
}

export interface DocRedoMessage {
  type: 'doc.redo';
  collection: string;
  docId: string;
  nodeId: string;
}

export interface PresenceUpdateMessage {
  type: 'presence.update';
  collection: string;
  docId: string;
  nodeId: string;
  presence: {
    cursor?: { line: number; column: number };
    selection?: { start: number; end: number };
    name?: string;
  };
}

export interface PingMessage {
  type: 'ping';
}

export type WebSocketMessage =
  | SubscribeMessage
  | DocSubscribeMessage
  | DocUpdateMessage
  | DocUndoMessage
  | DocRedoMessage
  | PresenceUpdateMessage
  | PingMessage;

export interface DocSyncedMessage {
  type: 'doc.synced';
  collection: string;
  docId: string;
  data: Record<string, unknown>;
  _version: number;
}

export interface PresenceChangedMessage {
  type: 'presence.changed';
  docId: string;
  nodeId: string;
  presence: Record<string, unknown>;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

/**
 * KimDB WebSocket Client for real-time synchronization
 */
export class KimDBWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private nodeId: string;
  private reconnectInterval: number;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;

  constructor(url: string, nodeId?: string) {
    super();
    this.url = url;
    this.nodeId = nodeId || `client-${Math.random().toString(36).substr(2, 9)}`;
    this.reconnectInterval = 5000;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.isConnected = true;
          console.log(`[KimDB] WebSocket connected (nodeId: ${this.nodeId})`);
          this.startHeartbeat();
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data as string);
            this.handleMessage(message);
          } catch (error) {
            console.error('[KimDB] Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[KimDB] WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          console.log('[KimDB] WebSocket disconnected');
          this.stopHeartbeat();
          this.emit('disconnected');
          this.reconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: any): void {
    switch (message.type) {
      case 'subscribed':
        this.emit('subscribed', message.collection);
        break;

      case 'doc.synced':
        this.emit('doc.synced', {
          collection: message.collection,
          docId: message.docId,
          data: message.data,
          version: message._version,
        });
        break;

      case 'doc.updated':
        this.emit('doc.updated', {
          docId: message.docId,
          success: message.success,
          version: message._version,
        });
        break;

      case 'presence.changed':
        this.emit('presence.changed', {
          docId: message.docId,
          nodeId: message.nodeId,
          presence: message.presence,
        });
        break;

      case 'pong':
        this.emit('pong', message.timestamp);
        break;

      case 'error':
        console.error('[KimDB] Server error:', message.error);
        this.emit('error', new Error(message.error));
        break;

      default:
        console.warn('[KimDB] Unknown message type:', message.type);
    }
  }

  /**
   * Subscribe to collection updates
   */
  subscribe(collection: string): void {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    const message: SubscribeMessage = { type: 'subscribe', collection };
    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Subscribe to specific document
   */
  subscribeDocument(collection: string, docId: string): void {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    const message: DocSubscribeMessage = {
      type: 'doc.subscribe',
      collection,
      docId,
    };
    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Update document with CRDT sync
   */
  updateDocument(
    collection: string,
    docId: string,
    data: Record<string, unknown>
  ): void {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    const message: DocUpdateMessage = {
      type: 'doc.update',
      collection,
      docId,
      data,
      nodeId: this.nodeId,
    };
    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Undo last operation
   */
  undo(collection: string, docId: string): void {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    const message: DocUndoMessage = {
      type: 'doc.undo',
      collection,
      docId,
      nodeId: this.nodeId,
    };
    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Redo operation
   */
  redo(collection: string, docId: string): void {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    const message: DocRedoMessage = {
      type: 'doc.redo',
      collection,
      docId,
      nodeId: this.nodeId,
    };
    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Update presence information
   */
  updatePresence(
    collection: string,
    docId: string,
    presence: Record<string, unknown>
  ): void {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    const message: PresenceUpdateMessage = {
      type: 'presence.update',
      collection,
      docId,
      nodeId: this.nodeId,
      presence: presence as any,
    };
    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Send heartbeat ping
   */
  private ping(): void {
    if (this.isConnected) {
      const message: PingMessage = { type: 'ping' };
      this.ws?.send(JSON.stringify(message));
    }
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => this.ping(), 30000);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }

  /**
   * Attempt reconnection
   */
  private reconnect(): void {
    console.log('[KimDB] Reconnecting in 5 seconds...');
    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[KimDB] Reconnection failed:', error);
      });
    }, this.reconnectInterval);
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Check connection status
   */
  connected(): boolean {
    return this.isConnected;
  }
}

export default KimDBWebSocket;
