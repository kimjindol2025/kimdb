package kimdb

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Client configuration
type Config struct {
	BaseURL string
	Token   string
	APIKey  string
	Timeout time.Duration
	Retries int
}

// Client is the KimDB REST API client
type Client struct {
	baseURL string
	token   string
	apiKey  string
	timeout time.Duration
	retries int
	client  *http.Client
}

// Document represents a KimDB document
type Document struct {
	ID       string                 `json:"id"`
	Data     map[string]interface{} `json:"data"`
	Version  int                    `json:"_version"`
	Created  *string                `json:"_created,omitempty"`
	Updated  *string                `json:"_updated,omitempty"`
}

// DocumentQuery represents query parameters for document retrieval
type DocumentQuery struct {
	Limit *int
	Skip  *int
	Sort  *string
}

// HealthResponse represents server health status
type HealthResponse struct {
	Status      string `json:"status"`
	Version     string `json:"version"`
	ServerID    string `json:"serverId"`
	Uptime      int    `json:"uptime"`
	Connections int    `json:"connections"`
}

// CollectionResponse represents collection response
type CollectionResponse struct {
	Success    bool       `json:"success"`
	Collection string     `json:"collection"`
	Count      int        `json:"count"`
	Data       []Document `json:"data"`
}

// SQLResponse represents SQL query response
type SQLResponse struct {
	Success bool                     `json:"success"`
	Rows    []map[string]interface{} `json:"rows"`
	Count   int                      `json:"count"`
}

// MetricsResponse represents server metrics
type MetricsResponse struct {
	Success    bool                   `json:"success"`
	Version    string                 `json:"version"`
	ServerID   string                 `json:"serverId"`
	UptimeSeconds int                 `json:"uptime_seconds"`
	Requests   map[string]int         `json:"requests"`
	WebSocket  map[string]interface{} `json:"websocket"`
	Sync       map[string]int         `json:"sync"`
	Cache      map[string]int         `json:"cache"`
	Memory     map[string]interface{} `json:"memory"`
}

// NewClient creates a new KimDB client
func NewClient(config Config) *Client {
	timeout := config.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	retries := config.Retries
	if retries == 0 {
		retries = 3
	}

	return &Client{
		baseURL: config.BaseURL,
		token:   config.Token,
		apiKey:  config.APIKey,
		timeout: timeout,
		retries: retries,
		client: &http.Client{
			Timeout: timeout,
		},
	}
}

// request makes an HTTP request with error handling and retries
func (c *Client) request(method, path string, body interface{}, result interface{}) error {
	var lastErr error

	for attempt := 0; attempt <= c.retries; attempt++ {
		url := c.baseURL + path
		var req *http.Request
		var err error

		if body != nil {
			jsonBody, err := json.Marshal(body)
			if err != nil {
				return fmt.Errorf("failed to marshal request body: %w", err)
			}
			req, err = http.NewRequest(method, url, bytes.NewReader(jsonBody))
		} else {
			req, err = http.NewRequest(method, url, nil)
		}

		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}

		// Set headers
		req.Header.Set("Content-Type", "application/json")
		if c.token != "" {
			req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.token))
		} else if c.apiKey != "" {
			req.Header.Set("X-API-Key", c.apiKey)
		}

		// Execute request
		resp, err := c.client.Do(req)
		if err != nil {
			lastErr = err
			if attempt < c.retries {
				time.Sleep(time.Duration(attempt+1) * time.Second)
				continue
			}
			return lastErr
		}

		defer resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			respBody, _ := io.ReadAll(resp.Body)
			lastErr = fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
			if attempt < c.retries {
				time.Sleep(time.Duration(attempt+1) * time.Second)
				continue
			}
			return lastErr
		}

		if result != nil {
			if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
				return fmt.Errorf("failed to decode response: %w", err)
			}
		}

		return nil
	}

	return lastErr
}

// Health checks server health
func (c *Client) Health() (*HealthResponse, error) {
	var result HealthResponse
	if err := c.request("GET", "/health", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Metrics gets server metrics
func (c *Client) Metrics() (*MetricsResponse, error) {
	var result MetricsResponse
	if err := c.request("GET", "/api/metrics", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ListCollections lists all collections
func (c *Client) ListCollections() ([]string, error) {
	var result map[string]interface{}
	if err := c.request("GET", "/api/collections", nil, &result); err != nil {
		return nil, err
	}

	collections := []string{}
	if cols, ok := result["collections"].([]interface{}); ok {
		for _, col := range cols {
			if s, ok := col.(string); ok {
				collections = append(collections, s)
			}
		}
	}

	return collections, nil
}

// GetCollection gets all documents in a collection
func (c *Client) GetCollection(collection string, query *DocumentQuery) (*CollectionResponse, error) {
	path := fmt.Sprintf("/api/c/%s", collection)

	if query != nil {
		values := url.Values{}
		if query.Limit != nil {
			values.Set("limit", fmt.Sprintf("%d", *query.Limit))
		}
		if query.Skip != nil {
			values.Set("skip", fmt.Sprintf("%d", *query.Skip))
		}
		if query.Sort != nil {
			values.Set("sort", *query.Sort)
		}
		if len(values) > 0 {
			path += "?" + values.Encode()
		}
	}

	var result CollectionResponse
	if err := c.request("GET", path, nil, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

// GetDocument gets a specific document
func (c *Client) GetDocument(collection, docID string) (*Document, error) {
	var result map[string]interface{}
	path := fmt.Sprintf("/api/c/%s/%s", collection, docID)

	if err := c.request("GET", path, nil, &result); err != nil {
		return nil, err
	}

	doc := &Document{
		ID:      result["id"].(string),
		Version: int(result["_version"].(float64)),
	}

	if data, ok := result["data"].(map[string]interface{}); ok {
		doc.Data = data
	}

	return doc, nil
}

// Query executes a SQL query
func (c *Client) Query(sql, collection string, params []interface{}) (*SQLResponse, error) {
	body := map[string]interface{}{
		"sql":        sql,
		"collection": collection,
	}

	if params != nil {
		body["params"] = params
	}

	var result SQLResponse
	if err := c.request("POST", "/api/sql", body, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

// QueryUsersByAge queries users by minimum age
func (c *Client) QueryUsersByAge(minAge int) ([]map[string]interface{}, error) {
	result, err := c.Query(
		"SELECT * FROM users WHERE age > ? ORDER BY name",
		"users",
		[]interface{}{minAge},
	)

	if err != nil {
		return nil, err
	}

	return result.Rows, nil
}

// Count counts documents in a collection
func (c *Client) Count(collection string, whereClause *string) (int, error) {
	sql := fmt.Sprintf("SELECT COUNT(*) as total FROM %s", collection)
	if whereClause != nil {
		sql += fmt.Sprintf(" WHERE %s", *whereClause)
	}

	result, err := c.Query(sql, collection, nil)
	if err != nil {
		return 0, err
	}

	if len(result.Rows) > 0 {
		if total, ok := result.Rows[0]["total"].(float64); ok {
			return int(total), nil
		}
	}

	return 0, nil
}

// GroupBy groups by a field
func (c *Client) GroupBy(collection, field string) (map[string]int, error) {
	sql := fmt.Sprintf("SELECT %s, COUNT(*) as count FROM %s GROUP BY %s", field, collection, field)

	result, err := c.Query(sql, collection, nil)
	if err != nil {
		return nil, err
	}

	grouped := make(map[string]int)
	for _, row := range result.Rows {
		if key, ok := row[field]; ok {
			if count, ok := row["count"].(float64); ok {
				grouped[fmt.Sprintf("%v", key)] = int(count)
			}
		}
	}

	return grouped, nil
}

// Close closes the client
func (c *Client) Close() error {
	c.client.CloseIdleConnections()
	return nil
}
