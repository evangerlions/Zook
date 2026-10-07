package api

import (
	"encoding/json"
	"net/http"
)

// ErrorResponse is the standard JSON error response format
type ErrorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Field   string `json:"field,omitempty"`
	} `json:"error"`
}

// JSONError sends a structured JSON error response
func JSONError(w http.ResponseWriter, code int, errCode string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error: struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Field   string `json:"field,omitempty"`
		}{
			Code:    errCode,
			Message: message,
		},
	})
}

// JSONErrorWithField sends a structured JSON error response with field context
func JSONErrorWithField(w http.ResponseWriter, code int, errCode string, message string, field string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error: struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Field   string `json:"field,omitempty"`
		}{
			Code:    errCode,
			Message: message,
			Field:   field,
		},
	})
}

// SuccessResponse wraps successful data with metadata
type SuccessResponse struct {
	Data   interface{} `json:"data"`
	Meta   *Meta       `json:"meta,omitempty"`
}

// Meta holds pagination or count metadata
type Meta struct {
	Total  int    `json:"total,omitempty"`
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

// JSON sends a structured JSON success response
func JSON(w http.ResponseWriter, data interface{}, meta *Meta) {
	w.Header().Set("Content-Type", "application/json")
	if meta != nil {
		json.NewEncoder(w).Encode(SuccessResponse{Data: data, Meta: meta})
	} else {
		json.NewEncoder(w).Encode(data)
	}
}
