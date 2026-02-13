# kimdb-go

High-performance document database Go client for KimDB with CRDT real-time synchronization.

## Features

- 🚀 REST API client with automatic retries
- 🔄 WebSocket real-time synchronization
- 🔐 JWT and API Key authentication
- 📊 Full type safety with Go generics
- ⚡ Connection pooling and concurrent requests
- 🛡️ Automatic error handling and recovery

## Installation

```bash
go get github.com/kim/kimdb-go
```

## Quick Start

### REST API (Synchronous Operations)

```go
package main

import (
	"fmt"
	"log"

	"github.com/kim/kimdb-go"
)

func main() {
	client := kimdb.NewClient(kimdb.Config{
		BaseURL: "http://localhost:40000",
		Token:   "your-jwt-token", // or APIKey: "your-api-key"
	})
	defer client.Close()

	// Get all documents
	users, err := client.GetCollection("users", nil)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Users: %v\n", users.Data)

	// Get specific document
	user, err := client.GetDocument("users", "user-001")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("User: %v\n", user.Data)

	// SQL query
	results, err := client.Query(
		"SELECT * FROM users WHERE age > ? ORDER BY name",
		"users",
		[]interface{}{18},
	)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Results: %v\n", results.Rows)

	// Health check
	health, err := client.Health()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Status: %s\n", health.Status)

	// Metrics
	metrics, err := client.Metrics()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Connections: %v\n", metrics.WebSocket["connections"])
}
```

### WebSocket (Real-time Synchronization)

```go
package main

import (
	"fmt"
	"log"
	"time"

	"github.com/kim/kimdb-go"
)

func main() {
	ws := kimdb.NewWebSocket("ws://localhost:40000/ws", nil)

	// Connect
	if err := ws.Connect(); err != nil {
		log.Fatal(err)
	}
	defer ws.Disconnect()

	// Subscribe to collection
	ws.Subscribe("users")

	// Listen for updates
	ws.On("doc.synced", func(event kimdb.WebSocketEvent) {
		fmt.Printf("Document updated: %v\n", event.Data["docId"])
		fmt.Printf("Data: %v\n", event.Data["data"])
	})

	// Update document
	ws.UpdateDocument("users", "user-001", map[string]interface{}{
		"name":         "John Doe Updated",
		"lastModified": time.Now().String(),
	})

	// Track presence
	ws.UpdatePresence("users", "user-001", map[string]interface{}{
		"cursor": map[string]int{"line": 10, "column": 5},
		"name":   "John",
	})

	// Listen for presence changes
	ws.On("presence.changed", func(event kimdb.WebSocketEvent) {
		fmt.Printf("%s moved to %v\n", event.Data["nodeId"], event.Data["presence"])
	})

	// Undo/Redo
	ws.Undo("users", "user-001")
	ws.Redo("users", "user-001")

	// Keep connection alive
	select {}
}
```

## API Reference

### Client

#### Constructor

```go
client := kimdb.NewClient(kimdb.Config{
	BaseURL: "http://localhost:40000",
	Token:   "your-jwt-token",  // or APIKey: "your-api-key"
	Timeout: 30 * time.Second,  // optional, default 30s
	Retries: 3,                 // optional, default 3
})
```

#### Methods

**Core Operations:**
- `Health() (*HealthResponse, error)` - Check server health
- `Metrics() (*MetricsResponse, error)` - Get performance metrics
- `ListCollections() ([]string, error)` - List all collections
- `GetCollection(collection string, query *DocumentQuery) (*CollectionResponse, error)` - Get all documents
- `GetDocument(collection, docID string) (*Document, error)` - Get specific document
- `Query(sql, collection string, params []interface{}) (*SQLResponse, error)` - Execute SQL query

**Helper Methods:**
- `QueryUsersByAge(minAge int) ([]map[string]interface{}, error)` - Query users by age
- `Count(collection string, whereClause *string) (int, error)` - Count documents
- `GroupBy(collection, field string) (map[string]int, error)` - Group by aggregation

**Connection Management:**
- `Close() error` - Close the client

### WebSocket

#### Constructor

```go
ws := kimdb.NewWebSocket("ws://localhost:40000/ws", nodeID)
```

**Parameters:**
- `url` (string): WebSocket URL
- `nodeID` (*string): Optional client node ID (auto-generated if nil)

#### Methods

**Connection:**
- `Connect() error` - Connect to server
- `Disconnect()` - Close connection
- `IsConnected() bool` - Check connection status

**Subscription:**
- `Subscribe(collection string) error` - Subscribe to collection updates
- `SubscribeDocument(collection, docID string) error` - Subscribe to specific document

**Operations:**
- `UpdateDocument(collection, docID string, data map[string]interface{}) error` - Update document
- `Undo(collection, docID string) error` - Undo last operation
- `Redo(collection, docID string) error` - Redo operation
- `UpdatePresence(collection, docID string, presence map[string]interface{}) error` - Update presence

**Events:**
- `On(event string, handler func(WebSocketEvent)) - Register event handler

**Supported Events:**
- `connected` - Connected to server
- `disconnected` - Disconnected from server
- `subscribed` - Subscribed to collection
- `doc.synced` - Document update received
- `doc.updated` - Document update confirmed
- `presence.changed` - Presence update from another client
- `pong` - Heartbeat response
- `error` - Error occurred

## Examples

### Pagination

```go
limit := 20
skip := 0

response, err := client.GetCollection("users", &kimdb.DocumentQuery{
	Limit: &limit,
	Skip:  &skip,
	Sort:  stringPtr("created"),
})

if err != nil {
	log.Fatal(err)
}

fmt.Printf("Page 1: %d items\n", len(response.Data))
```

### Advanced SQL

```go
// Join query
results, err := client.Query(`
	SELECT u.id, u.name, COUNT(p.id) as post_count
	FROM users u
	LEFT JOIN posts p ON u.id = p.userId
	GROUP BY u.id
	ORDER BY post_count DESC
`, "users", nil)

if err != nil {
	log.Fatal(err)
}

for _, row := range results.Rows {
	fmt.Printf("%s: %d posts\n", row["name"], row["post_count"])
}
```

### Real-time Collaborative Editor

```go
ws := kimdb.NewWebSocket("ws://localhost:40000/ws", nil)
if err := ws.Connect(); err != nil {
	log.Fatal(err)
}

// Subscribe to document
ws.SubscribeDocument("documents", "doc-123")

// Listen for remote changes
ws.On("doc.synced", func(event kimdb.WebSocketEvent) {
	data := event.Data["data"].(map[string]interface{})
	content := data["content"].(string)
	renderContent(content)
})

// Listen for presence
ws.On("presence.changed", func(event kimdb.WebSocketEvent) {
	presence := event.Data["presence"].(map[string]interface{})
	fmt.Printf("%s is editing...\n", presence["name"])
	showCursor(event.Data["nodeId"], presence["cursor"])
})

// Send local changes
func onContentChange(newContent string) {
	ws.UpdateDocument("documents", "doc-123", map[string]interface{}{
		"content":      newContent,
		"lastModified": time.Now(),
	})

	ws.UpdatePresence("documents", "doc-123", map[string]interface{}{
		"cursor": getCursorPosition(),
		"name":   getCurrentUserName(),
	})
}

// Undo/Redo
func onUndo() {
	ws.Undo("documents", "doc-123")
}

func onRedo() {
	ws.Redo("documents", "doc-123")
}
```

### Error Handling

```go
user, err := client.GetDocument("users", "user-001")
if err != nil {
	switch err.Error() {
	case "HTTP 404":
		fmt.Println("User not found")
	case "HTTP 401":
		fmt.Println("Authentication failed")
	default:
		fmt.Printf("Error: %v\n", err)
	}
}

// WebSocket error handling
ws.On("error", func(event kimdb.WebSocketEvent) {
	fmt.Printf("WebSocket error: %v\n", event.Error)
	// Client will auto-reconnect
})
```

### Batch Operations

```go
// Count users
count, err := client.Count("users", nil)
if err != nil {
	log.Fatal(err)
}
fmt.Printf("Total users: %d\n", count)

// Count with condition
whereClause := "active = 1"
activeCount, err := client.Count("users", &whereClause)
if err != nil {
	log.Fatal(err)
}
fmt.Printf("Active users: %d\n", activeCount)

// Group by role
grouped, err := client.GroupBy("users", "role")
if err != nil {
	log.Fatal(err)
}
for role, count := range grouped {
	fmt.Printf("%s: %d users\n", role, count)
}
```

## Authentication

### JWT Token

```go
client := kimdb.NewClient(kimdb.Config{
	BaseURL: "http://localhost:40000",
	Token:   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
})
```

### API Key

```go
client := kimdb.NewClient(kimdb.Config{
	BaseURL: "http://localhost:40000",
	APIKey:  "your-64-character-api-key",
})
```

## Testing

```bash
go test ./...
go test -cover ./...
go test -race ./...
```

## Performance Tips

1. **Batch Operations**: Use SQL queries for bulk operations
2. **Connection Pooling**: Reuse client instances
3. **WebSocket Subscriptions**: Use selective subscriptions
4. **Pagination**: Use Limit and Skip for large datasets
5. **Concurrency**: Use goroutines for concurrent requests

## License

MIT

## Support

- [KimDB Documentation](https://github.com/kim/kimdb/docs)
- [API Reference](../kimdb-client/docs/API.md)
- [Authentication Guide](../kimdb-client/docs/AUTHENTICATION.md)
