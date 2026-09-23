package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/xeipuuv/gojsonschema"
)

// FallbackResult is the result of a plan generation attempt
type FallbackResult struct {
	Plan    map[string]interface{}
	Source  string // "ai" | "ai_strict" | "template"
	Success bool
	Error   error
}

// GenerateWithFallback tries standard, then strict, then template
func (s *Service) GenerateWithFallback(ctx context.Context, systemPrompt, userPrompt string, schema string) FallbackResult {
	// Attempt 1: Standard prompt
	result, err := s.callAI(ctx, systemPrompt, userPrompt)
	if err == nil {
		parsed, err := s.extractAndValidateJSON(result, schema)
		if err == nil {
			return FallbackResult{Plan: parsed, Source: "ai", Success: true}
		}
		log.Printf("AI attempt 1 JSON validation failed: %v", err)
	} else {
		log.Printf("AI attempt 1 failed: %v", err)
	}

	// Attempt 2: Stricter prompt
	strictSystem := systemPrompt + "\n\n## IMPORTANT\n你输出的内容必须是可以解析的 JSON。不要包含任何其他文本、解释或 markdown 代码块标记。只输出纯 JSON。"
	result, err = s.callAI(ctx, strictSystem, userPrompt)
	if err == nil {
		parsed, err := s.extractAndValidateJSON(result, schema)
		if err == nil {
			return FallbackResult{Plan: parsed, Source: "ai_strict", Success: true}
		}
		log.Printf("AI attempt 2 (strict) JSON validation failed: %v", err)
	} else {
		log.Printf("AI attempt 2 failed: %v", err)
	}

	// Attempt 3: Template fallback - return nil to signal handler should use template
	return FallbackResult{Source: "template", Success: false, Error: fmt.Errorf("ai generation failed, using template")}
}

func (s *Service) callAI(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	result, _, _, err := s.Generate(ctx, systemPrompt, userPrompt)
	return result, err
}

// extractAndValidateJSON extracts JSON from the response and validates against schema
func (s *Service) extractAndValidateJSON(raw, schema string) (map[string]interface{}, error) {
	// Extract JSON from the response (handle markdown code blocks)
	jsonStr := extractJSON(raw)
	if jsonStr == "" {
		return nil, fmt.Errorf("no JSON found in response")
	}

	// Validate against schema
	schemaLoader := gojsonschema.NewStringLoader(schema)
	documentLoader := gojsonschema.NewStringLoader(jsonStr)

	result, err := gojsonschema.Validate(schemaLoader, documentLoader)
	if err != nil {
		return nil, fmt.Errorf("schema validation: %w", err)
	}

	if !result.Valid() {
		var errs []string
		for _, desc := range result.Errors() {
			errs = append(errs, desc.String())
		}
		return nil, fmt.Errorf("validation errors: %v", errs)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return nil, fmt.Errorf("json parse: %w", err)
	}

	return parsed, nil
}

// extractJSON finds JSON in a string that may contain markdown code blocks or other text
func extractJSON(s string) string {
	// Try to find ```json...``` blocks first
	if start := strings.Index(s, "```json"); start != -1 {
		start += 7
		if end := strings.Index(s[start:], "```"); end != -1 {
			return strings.TrimSpace(s[start : start+end])
		}
	}

	// Try to find ```...``` blocks
	if start := strings.Index(s, "```"); start != -1 {
		start += 3
		if end := strings.Index(s[start:], "```"); end != -1 {
			return strings.TrimSpace(s[start : start+end])
		}
	}

	// Try to find the first { and last }
	first := strings.Index(s, "{")
	last := strings.LastIndex(s, "}")
	if first != -1 && last > first {
		return s[first : last+1]
	}

	// Try array
	first = strings.Index(s, "[")
	last = strings.LastIndex(s, "]")
	if first != -1 && last > first {
		return s[first : last+1]
	}

	return ""
}
