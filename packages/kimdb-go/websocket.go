package kimdb

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WebSocketMessage represents a WebSocket message
type WebSocketMessage struct {
	Type       string                 `json:"type"`
	Collection string                 `json:"collection,omitempty"`
	DocID      string                 `json:"docId,omitempty"`
	Data       map[string]interface{} `json:"data,omitempty"`
	NodeID     string                 `json:"nodeId,omitempty"`
	Presence   map[string]interface{} `json:"presence,omitempty"`
	Timestamp  int64                  `json:"timestamp,omitempty"`
}

// WebSocketEvent represents an event
type WebSocketEvent struct {
	Type   string
	Data   map[string]interface{}
	Error  error
}

// WebSocket client for real-time synchronization
type WebSocket struct {
	url               string
	nodeID            string
	conn              *websocket.Conn
	connected         bool
	mu                sync.RWMutex
	messageHandlers   map[string][]func(WebSocketEvent)
	heartbeatTicker   *time.Ticker
	reconnectInterval time.Duration
}

// NewWebSocket creates a new WebSocket client
func NewWebSocket(url string, nodeID *string) *WebSocket {
	id := *nodeID
	if id == "" {
		id = fmt.Sprintf("client-%d", rand.Int63())
	}

	return &WebSocket{
		url:               url,
		nodeID:            id,
		messageHandlers:   make(map[string][]func(WebSocketEvent)),
		reconnectInterval: 5 * time.Second,
	}
}

// On registers an event handler
func (ws *WebSocket) On(event string, handler func(WebSocketEvent)) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	ws.messageHandlers[event] = append(ws.messageHandlers[event], handler)
}

// Connect connects to the WebSocket server
func (ws *WebSocket) Connect() error {
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.Dial(ws.url, nil)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	ws.mu.Lock()
	ws.conn = conn
	ws.connected = true
	ws.mu.Unlock()

	log.Printf("[KimDB] WebSocket connected (nodeId: %s)", ws.nodeID)
	ws.emit(WebSocketEvent{Type: "connected"})

	ws.startHeartbeat()
	go ws.readMessages()

	return nil
}

// readMessages reads incoming messages
func (ws *WebSocket) readMessages() {
	defer ws.disconnect()

	for {
		ws.mu.RLock()
		if !ws.connected {
			ws.mu.RUnlock()
			return
		}
		conn := ws.conn
		ws.mu.RUnlock()

		var msg WebSocketMessage
		err := conn.ReadJSON(&msg)
		if err != nil {
			ws.mu.Lock()
			ws.connected = false
			ws.mu.Unlock()
			log.Printf("[KimDB] WebSocket error: %v", err)
			ws.emit(WebSocketEvent{Type: "disconnected"})
			return
		}

		ws.handleMessage(msg)
	}
}

// handleMessage processes an incoming message
func (ws *WebSocket) handleMessage(msg WebSocketMessage) {
	event := WebSocketEvent{
		Type: msg.Type,
		Data: make(map[string]interface{}),
	}

	switch msg.Type {
	case "subscribed":
		event.Data["collection"] = msg.Collection
	case "doc.synced":
		event.Data["collection"] = msg.Collection
		event.Data["docId"] = msg.DocID
		event.Data["data"] = msg.Data
		event.Data["version"] = msg.Timestamp
	case "doc.updated":
		event.Data["docId"] = msg.DocID
		event.Data["success"] = true
	case "presence.changed":
		event.Data["docId"] = msg.DocID
		event.Data["nodeId"] = msg.NodeID
		event.Data["presence"] = msg.Presence
	case "pong":
		event.Data["timestamp"] = msg.Timestamp
	case "error":
		event.Error = fmt.Errorf("%v", msg.Data["error"])
	}

	ws.emit(event)
}

// emit emits an event to all registered handlers
func (ws *WebSocket) emit(event WebSocketEvent) {
	ws.mu.RLock()
	handlers := ws.messageHandlers[event.Type]
	ws.mu.RUnlock()

	for _, handler := range handlers {
		go handler(event)
	}
}

// Subscribe subscribes to collection updates
func (ws *WebSocket) Subscribe(collection string) error {
	ws.mu.RLock()
	if !ws.connected {
		ws.mu.RUnlock()
		return fmt.Errorf("not connected")
	}
	conn := ws.conn
	ws.mu.RUnlock()

	msg := WebSocketMessage{
		Type:       "subscribe",
		Collection: collection,
	}

	return conn.WriteJSON(msg)
}

// SubscribeDocument subscribes to a specific document
func (ws *WebSocket) SubscribeDocument(collection, docID string) error {
	ws.mu.RLock()
	if !ws.connected {
		ws.mu.RUnlock()
		return fmt.Errorf("not connected")
	}
	conn := ws.conn
	ws.mu.RUnlock()

	msg := WebSocketMessage{
		Type:       "doc.subscribe",
		Collection: collection,
		DocID:      docID,
	}

	return conn.WriteJSON(msg)
}

// UpdateDocument updates a document
func (ws *WebSocket) UpdateDocument(collection, docID string, data map[string]interface{}) error {
	ws.mu.RLock()
	if !ws.connected {
		ws.mu.RUnlock()
		return fmt.Errorf("not connected")
	}
	conn := ws.conn
	ws.mu.RUnlock()

	msg := WebSocketMessage{
		Type:       "doc.update",
		Collection: collection,
		DocID:      docID,
		Data:       data,
		NodeID:     ws.nodeID,
	}

	return conn.WriteJSON(msg)
}

// Undo undoes the last operation
func (ws *WebSocket) Undo(collection, docID string) error {
	ws.mu.RLock()
	if !ws.connected {
		ws.mu.RUnlock()
		return fmt.Errorf("not connected")
	}
	conn := ws.conn
	ws.mu.RUnlock()

	msg := WebSocketMessage{
		Type:       "doc.undo",
		Collection: collection,
		DocID:      docID,
		NodeID:     ws.nodeID,
	}

	return conn.WriteJSON(msg)
}

// Redo redoes an operation
func (ws *WebSocket) Redo(collection, docID string) error {
	ws.mu.RLock()
	if !ws.connected {
		ws.mu.RUnlock()
		return fmt.Errorf("not connected")
	}
	conn := ws.conn
	ws.mu.RUnlock()

	msg := WebSocketMessage{
		Type:       "doc.redo",
		Collection: collection,
		DocID:      docID,
		NodeID:     ws.nodeID,
	}

	return conn.WriteJSON(msg)
}

// UpdatePresence updates presence information
func (ws *WebSocket) UpdatePresence(collection, docID string, presence map[string]interface{}) error {
	ws.mu.RLock()
	if !ws.connected {
		ws.mu.RUnlock()
		return fmt.Errorf("not connected")
	}
	conn := ws.conn
	ws.mu.RUnlock()

	msg := WebSocketMessage{
		Type:       "presence.update",
		Collection: collection,
		DocID:      docID,
		NodeID:     ws.nodeID,
		Presence:   presence,
	}

	return conn.WriteJSON(msg)
}

// startHeartbeat starts the heartbeat
func (ws *WebSocket) startHeartbeat() {
	ws.heartbeatTicker = time.NewTicker(30 * time.Second)

	go func() {
		for range ws.heartbeatTicker.C {
			ws.ping()
		}
	}()
}

// ping sends a ping message
func (ws *WebSocket) ping() {
	ws.mu.RLock()
	if !ws.connected {
		ws.mu.RUnlock()
		return
	}
	conn := ws.conn
	ws.mu.RUnlock()

	msg := WebSocketMessage{Type: "ping"}
	if err := conn.WriteJSON(msg); err != nil {
		log.Printf("[KimDB] Ping failed: %v", err)
	}
}

// disconnect disconnects from the server
func (ws *WebSocket) disconnect() {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	ws.connected = false

	if ws.heartbeatTicker != nil {
		ws.heartbeatTicker.Stop()
	}

	if ws.conn != nil {
		ws.conn.Close()
	}

	log.Println("[KimDB] WebSocket disconnected")
}

// Disconnect disconnects from the server
func (ws *WebSocket) Disconnect() {
	ws.disconnect()
}

// IsConnected checks if connected
func (ws *WebSocket) IsConnected() bool {
	ws.mu.RLock()
	defer ws.mu.RUnlock()
	return ws.connected
}
