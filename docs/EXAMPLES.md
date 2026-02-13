# KimDB Code Examples

Complete code examples for using KimDB API in different languages.

## 📋 Table of Contents

1. [JavaScript / Node.js](#javascript--nodejs)
2. [Python](#python)
3. [Go](#go)
4. [cURL](#curl)
5. [React / Web](#react--web)

---

## JavaScript / Node.js

### Setup

```bash
npm install --save-dev @types/node
# or
npm install jsonwebtoken node-fetch
```

### Basic REST Operations

```javascript
const fetch = require('node-fetch');

const API_URL = 'http://localhost:40000';
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================================================
// Authentication
// ============================================================================

async function generateToken(userId) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { sub: userId, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// ============================================================================
// Health & Metrics
// ============================================================================

async function getHealth() {
  const response = await fetch(`${API_URL}/health`);
  return response.json();
}

async function getMetrics() {
  const response = await fetch(`${API_URL}/api/metrics`);
  return response.json();
}

// ============================================================================
// Collections
// ============================================================================

async function listCollections(token) {
  const response = await fetch(`${API_URL}/api/collections`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

// ============================================================================
// Documents - REST
// ============================================================================

async function getCollection(collection, token) {
  const response = await fetch(`${API_URL}/api/c/${collection}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

async function getDocument(collection, docId, token) {
  const response = await fetch(`${API_URL}/api/c/${collection}/${docId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

// ============================================================================
// SQL Queries
// ============================================================================

async function executeSQL(sql, params = [], collection, token) {
  const response = await fetch(`${API_URL}/api/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ sql, params, collection })
  });
  return response.json();
}

// ============================================================================
// WebSocket Real-time
// ============================================================================

class KimDBClient {
  constructor(url = 'ws://localhost:40000/ws') {
    this.url = url;
    this.ws = null;
    this.clientId = null;
    this.handlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('Connected to KimDB');
        resolve();
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);

        if (message.type === 'connected') {
          this.clientId = message.clientId;
          console.log('Client ID:', this.clientId);
        }

        // Call registered handlers
        const handlers = this.handlers.get(message.type) || [];
        handlers.forEach(handler => handler(message));
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('Disconnected from KimDB');
      };
    });
  }

  on(messageType, handler) {
    if (!this.handlers.has(messageType)) {
      this.handlers.set(messageType, []);
    }
    this.handlers.get(messageType).push(handler);
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  subscribe(collection) {
    this.send({
      type: 'subscribe',
      collection: collection
    });
  }

  subscribeDocument(collection, docId) {
    this.send({
      type: 'doc.subscribe',
      collection: collection,
      docId: docId
    });
  }

  updateDocument(collection, docId, data) {
    this.send({
      type: 'doc.update',
      collection: collection,
      docId: docId,
      data: data,
      nodeId: this.clientId
    });
  }

  undo(collection, docId) {
    this.send({
      type: 'doc.undo',
      collection: collection,
      docId: docId,
      nodeId: this.clientId
    });
  }

  redo(collection, docId) {
    this.send({
      type: 'doc.redo',
      collection: collection,
      docId: docId,
      nodeId: this.clientId
    });
  }

  ping() {
    this.send({ type: 'ping' });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// ============================================================================
// Usage Example
// ============================================================================

async function main() {
  try {
    // 1. Check health
    const health = await getHealth();
    console.log('Health:', health);

    // 2. Generate token
    const token = await generateToken('user-001');
    console.log('Token:', token.substring(0, 20) + '...');

    // 3. List collections
    const collections = await listCollections(token);
    console.log('Collections:', collections);

    // 4. SQL Query
    const result = await executeSQL(
      'SELECT * FROM users WHERE age > ? ORDER BY name',
      [18],
      'users',
      token
    );
    console.log('Query result:', result);

    // 5. WebSocket
    const client = new KimDBClient();
    await client.connect();

    // Subscribe to collection
    client.subscribe('users');

    // Subscribe to document
    client.subscribeDocument('users', 'user-001');

    // Listen for updates
    client.on('doc.synced', (message) => {
      console.log('Document updated:', message);
    });

    // Update document
    setTimeout(() => {
      client.updateDocument('users', 'user-001', {
        name: 'Updated Name',
        lastModified: new Date().toISOString()
      });
    }, 1000);

    // Heartbeat
    setInterval(() => {
      client.ping();
    }, 30000);

  } catch (error) {
    console.error('Error:', error);
  }
}

main();
```

---

## Python

### Setup

```bash
pip install requests websocket-client pyjwt
```

### Basic REST Operations

```python
import requests
import json
import jwt
import websocket
from datetime import datetime, timedelta

API_URL = 'http://localhost:40000'
JWT_SECRET = os.getenv('JWT_SECRET')

# ============================================================================
# Authentication
# ============================================================================

def generate_token(user_id):
    payload = {
        'sub': user_id,
        'role': 'admin',
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')

# ============================================================================
# Health & Metrics
# ============================================================================

def get_health():
    response = requests.get(f'{API_URL}/health')
    return response.json()

def get_metrics():
    response = requests.get(f'{API_URL}/api/metrics')
    return response.json()

# ============================================================================
# Collections
# ============================================================================

def list_collections(token):
    headers = {'Authorization': f'Bearer {token}'}
    response = requests.get(f'{API_URL}/api/collections', headers=headers)
    return response.json()

# ============================================================================
# Documents
# ============================================================================

def get_collection(collection, token):
    headers = {'Authorization': f'Bearer {token}'}
    response = requests.get(f'{API_URL}/api/c/{collection}', headers=headers)
    return response.json()

def get_document(collection, doc_id, token):
    headers = {'Authorization': f'Bearer {token}'}
    response = requests.get(f'{API_URL}/api/c/{collection}/{doc_id}',
                           headers=headers)
    return response.json()

# ============================================================================
# SQL Queries
# ============================================================================

def execute_sql(sql, params=[], collection, token):
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}'
    }
    data = {
        'sql': sql,
        'params': params,
        'collection': collection
    }
    response = requests.post(f'{API_URL}/api/sql', json=data, headers=headers)
    return response.json()

# ============================================================================
# WebSocket Real-time
# ============================================================================

class KimDBClient:
    def __init__(self, url='ws://localhost:40000/ws'):
        self.url = url
        self.ws = None
        self.client_id = None
        self.handlers = {}

    def connect(self):
        self.ws = websocket.WebSocketApp(
            self.url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        self.ws.run_forever()

    def on_open(self, ws):
        print('Connected to KimDB')

    def on_message(self, ws, message):
        data = json.loads(message)

        if data['type'] == 'connected':
            self.client_id = data['clientId']
            print(f'Client ID: {self.client_id}')

        # Call handlers
        if data['type'] in self.handlers:
            for handler in self.handlers[data['type']]:
                handler(data)

    def on_error(self, ws, error):
        print(f'Error: {error}')

    def on_close(self, ws, close_status_code, close_msg):
        print('Disconnected from KimDB')

    def on(self, message_type, handler):
        if message_type not in self.handlers:
            self.handlers[message_type] = []
        self.handlers[message_type].append(handler)

    def send(self, message):
        if self.ws:
            self.ws.send(json.dumps(message))

    def subscribe(self, collection):
        self.send({
            'type': 'subscribe',
            'collection': collection
        })

    def subscribe_document(self, collection, doc_id):
        self.send({
            'type': 'doc.subscribe',
            'collection': collection,
            'docId': doc_id
        })

    def update_document(self, collection, doc_id, data):
        self.send({
            'type': 'doc.update',
            'collection': collection,
            'docId': doc_id,
            'data': data,
            'nodeId': self.client_id
        })

    def close(self):
        if self.ws:
            self.ws.close()

# ============================================================================
# Usage Example
# ============================================================================

def main():
    try:
        # 1. Check health
        health = get_health()
        print(f'Health: {health}')

        # 2. Generate token
        token = generate_token('user-001')
        print(f'Token: {token[:20]}...')

        # 3. List collections
        collections = list_collections(token)
        print(f'Collections: {collections}')

        # 4. SQL Query
        result = execute_sql(
            'SELECT * FROM users WHERE age > ? ORDER BY name',
            [18],
            'users',
            token
        )
        print(f'Query result: {result}')

        # 5. WebSocket (in separate thread)
        import threading

        client = KimDBClient()

        def subscribe_and_listen():
            client.subscribe('users')
            client.on('doc.synced', lambda msg: print(f'Updated: {msg}'))

        ws_thread = threading.Thread(target=client.connect)
        ws_thread.daemon = True
        ws_thread.start()

        threading.Timer(1.0, subscribe_and_listen).start()

    except Exception as e:
        print(f'Error: {e}')

if __name__ == '__main__':
    main()
```

---

## Go

### Setup

```bash
go get github.com/golang-jwt/jwt/v4
go get github.com/gorilla/websocket
```

### Basic REST Operations

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v4"
	"github.com/gorilla/websocket"
)

const (
	API_URL    = "http://localhost:40000"
	JWT_SECRET = "your-secret-key-here"
)

// ============================================================================
// Authentication
// ============================================================================

func generateToken(userID string) (string, error) {
	claims := jwt.MapClaims{
		"sub":  userID,
		"role": "admin",
		"iat":  time.Now().Unix(),
		"exp":  time.Now().Add(24 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(JWT_SECRET))
}

// ============================================================================
// Health & Metrics
// ============================================================================

type HealthResponse struct {
	Status      string `json:"status"`
	Version     string `json:"version"`
	ServerID    string `json:"serverId"`
	Uptime      int    `json:"uptime"`
	Connections int    `json:"connections"`
}

func getHealth() (*HealthResponse, error) {
	resp, err := http.Get(fmt.Sprintf("%s/health", API_URL))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var health HealthResponse
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return nil, err
	}

	return &health, nil
}

// ============================================================================
// SQL Queries
// ============================================================================

type SQLRequest struct {
	SQL        string        `json:"sql"`
	Params     []interface{} `json:"params"`
	Collection string        `json:"collection"`
}

type SQLResponse struct {
	Success bool            `json:"success"`
	Rows    []map[string]interface{} `json:"rows"`
	Count   int             `json:"count"`
}

func executeSQL(sql string, params []interface{}, collection, token string) (*SQLResponse, error) {
	req := SQLRequest{
		SQL:        sql,
		Params:     params,
		Collection: collection,
	}

	body, _ := json.Marshal(req)
	httpReq, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/sql", API_URL),
		bytes.NewBuffer(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result SQLResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}

// ============================================================================
// WebSocket Real-time
// ============================================================================

type KimDBClient struct {
	url      string
	ws       *websocket.Conn
	clientID string
}

type WSMessage struct {
	Type       string                 `json:"type"`
	Collection string                 `json:"collection,omitempty"`
	DocID      string                 `json:"docId,omitempty"`
	Data       map[string]interface{} `json:"data,omitempty"`
	NodeID     string                 `json:"nodeId,omitempty"`
}

func NewKimDBClient(url string) *KimDBClient {
	return &KimDBClient{url: url}
}

func (c *KimDBClient) Connect() error {
	ws, _, err := websocket.DefaultDialer.Dial(c.url, nil)
	if err != nil {
		return err
	}
	c.ws = ws

	// Read connected message
	var msg map[string]interface{}
	if err := ws.ReadJSON(&msg); err != nil {
		return err
	}

	if msg["type"] == "connected" {
		c.clientID = msg["clientId"].(string)
		fmt.Printf("Connected with client ID: %s\n", c.clientID)
	}

	return nil
}

func (c *KimDBClient) Subscribe(collection string) error {
	msg := WSMessage{
		Type:       "subscribe",
		Collection: collection,
	}
	return c.ws.WriteJSON(msg)
}

func (c *KimDBClient) UpdateDocument(collection, docID string, data map[string]interface{}) error {
	msg := WSMessage{
		Type:       "doc.update",
		Collection: collection,
		DocID:      docID,
		Data:       data,
		NodeID:     c.clientID,
	}
	return c.ws.WriteJSON(msg)
}

func (c *KimDBClient) ReadMessage() (map[string]interface{}, error) {
	var msg map[string]interface{}
	err := c.ws.ReadJSON(&msg)
	return msg, err
}

func (c *KimDBClient) Close() error {
	return c.ws.Close()
}

// ============================================================================
// Main
// ============================================================================

func main() {
	// Health check
	health, _ := getHealth()
	fmt.Printf("Health: %+v\n", health)

	// Generate token
	token, _ := generateToken("user-001")
	fmt.Printf("Token: %s...\n", token[:20])

	// SQL Query
	result, _ := executeSQL(
		"SELECT * FROM users WHERE age > ? ORDER BY name",
		[]interface{}{18},
		"users",
		token,
	)
	fmt.Printf("Query result: %+v\n", result)

	// WebSocket
	client := NewKimDBClient("ws://localhost:40000/ws")
	if err := client.Connect(); err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	defer client.Close()

	client.Subscribe("users")

	// Listen for messages
	go func() {
		for {
			msg, err := client.ReadMessage()
			if err != nil {
				break
			}
			fmt.Printf("Message: %+v\n", msg)
		}
	}()

	// Update document
	time.Sleep(1 * time.Second)
	client.UpdateDocument("users", "user-001", map[string]interface{}{
		"name":         "Updated Name",
		"lastModified": time.Now().Format(time.RFC3339),
	})

	time.Sleep(5 * time.Second)
}
```

---

## cURL

### Common Requests

```bash
# Health check
curl http://localhost:40000/health

# Metrics
curl http://localhost:40000/api/metrics

# List collections
curl http://localhost:40000/api/collections

# Get all users
curl http://localhost:40000/api/c/users

# Get specific user
curl http://localhost:40000/api/c/users/user-001

# SQL query with authentication
TOKEN="eyJ..." # Your JWT token
curl -X POST http://localhost:40000/api/sql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sql": "SELECT * FROM users WHERE age > ? ORDER BY name",
    "params": [18],
    "collection": "users"
  }'

# Save to file
curl -o response.json http://localhost:40000/api/c/users

# Verbose output
curl -v http://localhost:40000/health

# Include response headers
curl -i http://localhost:40000/health
```

---

## React / Web

### Setup

```bash
npm install --save axios jsonwebtoken
```

### Hook for KimDB

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const useKimDB = (apiUrl = 'http://localhost:40000') => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);

  // REST API requests with auth
  const request = useCallback(async (method, endpoint, data = null, token = null) => {
    try {
      setLoading(true);
      const config = {
        method,
        url: `${apiUrl}${endpoint}`,
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      };
      if (data) config.data = data;

      const response = await axios(config);
      return response.data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  // WebSocket connection
  const connect = useCallback((onMessage) => {
    wsRef.current = new WebSocket(`ws${apiUrl.startsWith('https') ? 's' : ''}://${apiUrl.split('://')[1]}/ws`);

    wsRef.current.onmessage = (event) => {
      onMessage(JSON.parse(event.data));
    };

    wsRef.current.onerror = (error) => {
      setError(error.message);
    };
  }, [apiUrl]);

  const send = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
  }, []);

  return { request, connect, send, disconnect, loading, error };
};

// Usage Component
export function UserList() {
  const { request, loading, error } = useKimDB();
  const [users, setUsers] = useState([]);
  const [token, setToken] = useState(null);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const data = await request('GET', '/api/c/users', null, token);
        setUsers(data.data);
      } catch (err) {
        console.error('Failed to load users:', err);
      }
    };

    if (token) {
      loadUsers();
    }
  }, [token, request]);

  return (
    <div>
      <h1>Users</h1>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      <ul>
        {users.map(user => (
          <li key={user.id}>{user.name} ({user.email})</li>
        ))}
      </ul>
    </div>
  );
}
```

---

## TypeScript

### Type Definitions

```typescript
interface Document {
  id: string;
  data: Record<string, any>;
  _version: number;
  _created?: string;
  _updated?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  serverId: string;
  uptime: number;
  connections: number;
}

interface SQLRequest {
  sql: string;
  params?: any[];
  collection: string;
}

interface SQLResponse {
  success: boolean;
  rows: Record<string, any>[];
  count: number;
}

interface WSMessage<T = any> {
  type: string;
  collection?: string;
  docId?: string;
  data?: T;
  nodeId?: string;
}

class KimDB {
  private apiUrl: string;
  private token?: string;

  constructor(apiUrl: string = 'http://localhost:40000') {
    this.apiUrl = apiUrl;
  }

  setToken(token: string): void {
    this.token = token;
  }

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.apiUrl}/health`);
    return response.json();
  }

  async getCollection(collection: string): Promise<Document[]> {
    const response = await fetch(`${this.apiUrl}/api/c/${collection}`, {
      headers: this.getHeaders()
    });
    const data = await response.json();
    return data.data;
  }

  async executeSQL<T = any>(
    sql: string,
    params: any[] = [],
    collection: string
  ): Promise<T[]> {
    const response = await fetch(`${this.apiUrl}/api/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getHeaders()
      },
      body: JSON.stringify({ sql, params, collection })
    });
    const data = await response.json();
    return data.rows;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }
}

export default KimDB;
```

---

## Running Examples

```bash
# Node.js
node examples/node-rest.js
node examples/node-websocket.js

# Python
python examples/python_rest.py
python examples/python_websocket.py

# Go
go run examples/go_rest.go
go run examples/go_websocket.go
```

---

See Also:
- [API Reference](./API.md)
- [Authentication Guide](./AUTHENTICATION.md)

Last updated: 2024-02-13
