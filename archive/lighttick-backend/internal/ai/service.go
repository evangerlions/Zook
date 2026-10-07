package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// Config for AI service
type Config struct {
	APIKey  string
	BaseURL string // optional, for compatible endpoints
	Model   string
	Timeout time.Duration
	CostCap int // weekly cost cap in cents
}

// Service handles all AI interactions
type Service struct {
	client    *http.Client
	apiKey    string
	baseURL   string
	model     string
	costCap   int
}

// NewService creates a new AI service
func NewService(cfg Config) *Service {
	return &Service{
		client: &http.Client{
			Timeout: cfg.Timeout,
		},
		apiKey:  cfg.APIKey,
		baseURL: cfg.BaseURL,
		model:   cfg.Model,
		costCap: cfg.CostCap,
	}
}

// ChatRequest is the OpenAI-compatible chat request
type ChatRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
}

// Message represents a chat message
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatResponse is the OpenAI-compatible chat response
type ChatResponse struct {
	Choices []struct {
		Message Message `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// Generate calls the AI API with the given prompt
func (s *Service) Generate(ctx context.Context, systemPrompt, userPrompt string) (string, int, int, error) {
	baseURL := s.baseURL
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}

	req := ChatRequest{
		Model: s.model,
		Messages: []Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	body, err := json.Marshal(req)
	if err != nil {
		return "", 0, 0, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", 0, 0, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+s.apiKey)

	resp, err := s.client.Do(httpReq)
	if err != nil {
		return "", 0, 0, fmt.Errorf("api call: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", 0, 0, fmt.Errorf("api error %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", 0, 0, fmt.Errorf("decode response: %w", err)
	}

	if len(chatResp.Choices) == 0 {
		return "", 0, 0, fmt.Errorf("no choices in response")
	}

	content := chatResp.Choices[0].Message.Content
	inputTokens := chatResp.Usage.PromptTokens
	outputTokens := chatResp.Usage.CompletionTokens

	log.Printf("AI call: model=%s input_tokens=%d output_tokens=%d", s.model, inputTokens, outputTokens)

	return content, inputTokens, outputTokens, nil
}

// EstimateCost estimates the cost in cents for given token counts
// Using GPT-4o pricing as reference: $2.50/1M input, $10/1M output
func EstimateCost(inputTokens, outputTokens int) int64 {
	inputCost := float64(inputTokens) * 2.50 / 1_000_000
	outputCost := float64(outputTokens) * 10.00 / 1_000_000
	return int64((inputCost + outputCost) * 100) // convert to cents
}
