// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated from workspace OpenAPI contracts for Zook public API boundaries.

export const PasswordLoginRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "account",
    "password"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "account": {
      "type": "string"
    },
    "password": {
      "type": "string"
    },
    "clientType": {
      "type": "string",
      "enum": [
        "app",
        "web"
      ]
    }
  }
} as const;

export type PasswordLoginRequest = {
  "appId": string;
  "account": string;
  "password": string;
  "clientType"?: "app" | "web";
};

export const EmailCodeRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "email"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "email": {
      "type": "string",
      "format": "email"
    }
  }
} as const;

export type EmailCodeRequest = {
  "appId": string;
  "email": string;
};

export const SmsCodeRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "phone",
    "phoneNa"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "phone": {
      "type": "string"
    },
    "phoneNa": {
      "type": "string",
      "example": "+86"
    },
    "test": {
      "type": "boolean",
      "default": false
    }
  }
} as const;

export type SmsCodeRequest = {
  "appId": string;
  "phone": string;
  "phoneNa": string;
  "test"?: boolean;
};

export const EmailLoginRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "email",
    "emailCode",
    "clientType"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "emailCode": {
      "type": "string"
    },
    "clientType": {
      "type": "string",
      "enum": [
        "app",
        "web"
      ]
    }
  }
} as const;

export type EmailLoginRequest = {
  "appId": string;
  "email": string;
  "emailCode": string;
  "clientType": "app" | "web";
};

export const SmsLoginRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "phone",
    "phoneNa",
    "smsCode",
    "clientType"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "phone": {
      "type": "string"
    },
    "phoneNa": {
      "type": "string",
      "example": "+86"
    },
    "smsCode": {
      "type": "string"
    },
    "clientType": {
      "type": "string",
      "enum": [
        "app",
        "web"
      ]
    }
  }
} as const;

export type SmsLoginRequest = {
  "appId": string;
  "phone": string;
  "phoneNa": string;
  "smsCode": string;
  "clientType": "app" | "web";
};

export const SetPasswordRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "password",
    "clientType"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "password": {
      "type": "string",
      "minLength": 10,
      "maxLength": 256
    },
    "clientType": {
      "type": "string",
      "enum": [
        "app",
        "web"
      ]
    }
  }
} as const;

export type SetPasswordRequest = {
  "appId": string;
  "password": string;
  "clientType": "app" | "web";
};

export const ResetPasswordRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "email",
    "emailCode",
    "password",
    "clientType"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "emailCode": {
      "type": "string"
    },
    "password": {
      "type": "string",
      "minLength": 10,
      "maxLength": 256
    },
    "clientType": {
      "type": "string",
      "enum": [
        "app",
        "web"
      ]
    }
  }
} as const;

export type ResetPasswordRequest = {
  "appId": string;
  "email": string;
  "emailCode": string;
  "password": string;
  "clientType": "app" | "web";
};

export const ChangePasswordRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "currentPassword",
    "newPassword",
    "clientType"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "currentPassword": {
      "type": "string"
    },
    "newPassword": {
      "type": "string",
      "minLength": 10,
      "maxLength": 256
    },
    "clientType": {
      "type": "string",
      "enum": [
        "app",
        "web"
      ]
    }
  }
} as const;

export type ChangePasswordRequest = {
  "appId": string;
  "currentPassword": string;
  "newPassword": string;
  "clientType": "app" | "web";
};

export const RegisterRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "email",
    "emailCode",
    "password",
    "clientType"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "emailCode": {
      "type": "string"
    },
    "password": {
      "type": "string",
      "minLength": 10,
      "maxLength": 256
    },
    "clientType": {
      "type": "string",
      "enum": [
        "app",
        "web"
      ]
    }
  }
} as const;

export type RegisterRequest = {
  "appId": string;
  "email": string;
  "emailCode": string;
  "password": string;
  "clientType": "app" | "web";
};

export const QrLoginCreateRequestSchema = {
  "type": "object",
  "required": [
    "appId"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "clientType": {
      "type": "string",
      "enum": [
        "web",
        "app"
      ]
    }
  }
} as const;

export type QrLoginCreateRequest = {
  "appId": string;
  "clientType"?: "web" | "app";
};

export const RefreshRequestSchema = {
  "type": "object",
  "properties": {
    "appId": {
      "type": "string"
    },
    "refreshToken": {
      "type": "string"
    },
    "clientType": {
      "type": "string",
      "enum": [
        "app",
        "web"
      ]
    }
  }
} as const;

export type RefreshRequest = {
  "appId"?: string;
  "refreshToken"?: string;
  "clientType"?: "app" | "web";
};

export const LogoutRequestSchema = {
  "type": "object",
  "properties": {
    "appId": {
      "type": "string"
    },
    "scope": {
      "type": "string",
      "enum": [
        "current",
        "all"
      ],
      "default": "current"
    }
  }
} as const;

export type LogoutRequest = {
  "appId"?: string;
  "scope"?: "current" | "all";
};

export const AuthAcceptedDataSchema = {
  "type": "object",
  "additionalProperties": true
} as const;

export type AuthAcceptedData = {
  [key: string]: unknown;
};

export const UserSummarySchema = {
  "type": "object",
  "required": [
    "id",
    "name",
    "hasPassword"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "phone": {
      "type": [
        "string",
        "null"
      ]
    },
    "avatarUrl": {
      "type": [
        "string",
        "null"
      ]
    },
    "hasPassword": {
      "type": "boolean"
    }
  }
} as const;

export type UserSummary = {
  "id": string;
  "name": string;
  "email"?: string;
  "phone"?: string | null;
  "avatarUrl"?: string | null;
  "hasPassword": boolean;
};

export const AuthSessionDataSchema = {
  "type": "object",
  "required": [
    "accessToken",
    "user"
  ],
  "properties": {
    "accessToken": {
      "type": "string"
    },
    "refreshToken": {
      "type": "string"
    },
    "expiresIn": {
      "type": "integer"
    },
    "user": {
      "type": "object",
      "required": [
        "id",
        "name",
        "hasPassword"
      ],
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "email": {
          "type": "string",
          "format": "email"
        },
        "phone": {
          "type": [
            "string",
            "null"
          ]
        },
        "avatarUrl": {
          "type": [
            "string",
            "null"
          ]
        },
        "hasPassword": {
          "type": "boolean"
        }
      }
    }
  }
} as const;

export type AuthSessionData = {
  "accessToken": string;
  "refreshToken"?: string;
  "expiresIn"?: number;
  "user": {
  "id": string;
  "name": string;
  "email"?: string;
  "phone"?: string | null;
  "avatarUrl"?: string | null;
  "hasPassword": boolean;
};
};

export const QrLoginCreateDataSchema = {
  "type": "object",
  "required": [
    "loginId",
    "qrContent",
    "pollToken",
    "expiresInSeconds",
    "pollIntervalMs"
  ],
  "properties": {
    "loginId": {
      "type": "string"
    },
    "qrContent": {
      "type": "string"
    },
    "pollToken": {
      "type": "string"
    },
    "expiresInSeconds": {
      "type": "integer"
    },
    "pollIntervalMs": {
      "type": "integer"
    }
  }
} as const;

export type QrLoginCreateData = {
  "loginId": string;
  "qrContent": string;
  "pollToken": string;
  "expiresInSeconds": number;
  "pollIntervalMs": number;
};

export const QrLoginConfirmDataSchema = {
  "type": "object",
  "required": [
    "confirmed"
  ],
  "properties": {
    "confirmed": {
      "type": "boolean"
    }
  }
} as const;

export type QrLoginConfirmData = {
  "confirmed": boolean;
};

export const QrLoginPollDataSchema = {
  "discriminator": {
    "propertyName": "status"
  },
  "oneOf": [
    {
      "type": "object",
      "required": [
        "status",
        "expiresInSeconds",
        "pollIntervalMs"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "PENDING"
          ]
        },
        "expiresInSeconds": {
          "type": "integer"
        },
        "pollIntervalMs": {
          "type": "integer"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "status",
        "accessToken",
        "expiresIn",
        "user"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "CONFIRMED"
          ]
        },
        "accessToken": {
          "type": "string"
        },
        "expiresIn": {
          "type": "integer"
        },
        "user": {
          "type": "object",
          "required": [
            "id",
            "name",
            "hasPassword"
          ],
          "properties": {
            "id": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "email": {
              "type": "string",
              "format": "email"
            },
            "phone": {
              "type": [
                "string",
                "null"
              ]
            },
            "avatarUrl": {
              "type": [
                "string",
                "null"
              ]
            },
            "hasPassword": {
              "type": "boolean"
            }
          }
        }
      }
    }
  ]
} as const;

export type QrLoginPollData = {
  "status": "PENDING";
  "expiresInSeconds": number;
  "pollIntervalMs": number;
} | {
  "status": "CONFIRMED";
  "accessToken": string;
  "expiresIn": number;
  "user": {
  "id": string;
  "name": string;
  "email"?: string;
  "phone"?: string | null;
  "avatarUrl"?: string | null;
  "hasPassword": boolean;
};
};

export const CurrentUserDataSchema = {
  "type": "object",
  "required": [
    "appId",
    "user"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "user": {
      "type": "object",
      "required": [
        "id",
        "name",
        "hasPassword"
      ],
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "email": {
          "type": "string",
          "format": "email"
        },
        "phone": {
          "type": [
            "string",
            "null"
          ]
        },
        "avatarUrl": {
          "type": [
            "string",
            "null"
          ]
        },
        "hasPassword": {
          "type": "boolean"
        }
      }
    }
  }
} as const;

export type CurrentUserData = {
  "appId": string;
  "user": {
  "id": string;
  "name": string;
  "email"?: string;
  "phone"?: string | null;
  "avatarUrl"?: string | null;
  "hasPassword": boolean;
};
};

export const AnalyticsEventInputSchema = {
  "type": "object",
  "required": [
    "platform",
    "sessionId",
    "pageKey",
    "eventName",
    "occurredAt"
  ],
  "properties": {
    "platform": {
      "type": "string",
      "enum": [
        "web",
        "ios",
        "android"
      ]
    },
    "sessionId": {
      "type": "string"
    },
    "pageKey": {
      "type": "string"
    },
    "eventName": {
      "type": "string",
      "enum": [
        "page_view",
        "page_leave",
        "page_heartbeat"
      ]
    },
    "durationMs": {
      "type": "integer"
    },
    "occurredAt": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    }
  }
} as const;

export type AnalyticsEventInput = {
  "platform": "web" | "ios" | "android";
  "sessionId": string;
  "pageKey": string;
  "eventName": "page_view" | "page_leave" | "page_heartbeat";
  "durationMs"?: number;
  "occurredAt": string;
  "metadata"?: {
  [key: string]: unknown;
};
};

export const AnalyticsBatchRequestSchema = {
  "type": "object",
  "required": [
    "events"
  ],
  "properties": {
    "events": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": [
          "platform",
          "sessionId",
          "pageKey",
          "eventName",
          "occurredAt"
        ],
        "properties": {
          "platform": {
            "type": "string",
            "enum": [
              "web",
              "ios",
              "android"
            ]
          },
          "sessionId": {
            "type": "string"
          },
          "pageKey": {
            "type": "string"
          },
          "eventName": {
            "type": "string",
            "enum": [
              "page_view",
              "page_leave",
              "page_heartbeat"
            ]
          },
          "durationMs": {
            "type": "integer"
          },
          "occurredAt": {
            "type": "string",
            "format": "date-time"
          },
          "metadata": {
            "type": "object",
            "additionalProperties": true
          }
        }
      }
    }
  }
} as const;

export type AnalyticsBatchRequest = {
  "events": {
  "platform": "web" | "ios" | "android";
  "sessionId": string;
  "pageKey": string;
  "eventName": "page_view" | "page_leave" | "page_heartbeat";
  "durationMs"?: number;
  "occurredAt": string;
  "metadata"?: {
  [key: string]: unknown;
};
}[];
};

export const AnalyticsAcceptedDataSchema = {
  "type": "object",
  "required": [
    "accepted"
  ],
  "properties": {
    "accepted": {
      "type": "integer"
    }
  }
} as const;

export type AnalyticsAcceptedData = {
  "accepted": number;
};

export const FilePresignRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "fileName",
    "mimeType",
    "sizeBytes"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "fileName": {
      "type": "string"
    },
    "mimeType": {
      "type": "string"
    },
    "sizeBytes": {
      "type": "integer",
      "minimum": 0
    }
  }
} as const;

export type FilePresignRequest = {
  "appId": string;
  "fileName": string;
  "mimeType": string;
  "sizeBytes": number;
};

export const FilePresignDataSchema = {
  "type": "object",
  "required": [
    "uploadUrl",
    "storageKey",
    "expireAt"
  ],
  "properties": {
    "uploadUrl": {
      "type": "string"
    },
    "storageKey": {
      "type": "string"
    },
    "expireAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type FilePresignData = {
  "uploadUrl": string;
  "storageKey": string;
  "expireAt": string;
};

export const FileConfirmRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "storageKey",
    "mimeType",
    "sizeBytes"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "storageKey": {
      "type": "string"
    },
    "mimeType": {
      "type": "string"
    },
    "sizeBytes": {
      "type": "integer",
      "minimum": 0
    }
  }
} as const;

export type FileConfirmRequest = {
  "appId": string;
  "storageKey": string;
  "mimeType": string;
  "sizeBytes": number;
};

export const FileConfirmDataSchema = {
  "type": "object",
  "required": [
    "storageKey",
    "downloadUrl"
  ],
  "properties": {
    "storageKey": {
      "type": "string"
    },
    "downloadUrl": {
      "type": "string"
    }
  }
} as const;

export type FileConfirmData = {
  "storageKey": string;
  "downloadUrl": string;
};

export const LogPolicyDataSchema = {
  "type": "object",
  "required": [
    "enabled",
    "minPullIntervalSeconds"
  ],
  "properties": {
    "enabled": {
      "type": "boolean"
    },
    "minPullIntervalSeconds": {
      "type": "integer"
    }
  }
} as const;

export type LogPolicyData = {
  "enabled": boolean;
  "minPullIntervalSeconds": number;
};

export const LogPullTaskDataSchema = {
  "discriminator": {
    "propertyName": "shouldUpload"
  },
  "oneOf": [
    {
      "type": "object",
      "required": [
        "shouldUpload"
      ],
      "properties": {
        "shouldUpload": {
          "type": "boolean",
          "enum": [
            false
          ]
        }
      }
    },
    {
      "type": "object",
      "required": [
        "shouldUpload",
        "taskId",
        "claimToken",
        "claimExpireAtMs",
        "keyId"
      ],
      "properties": {
        "shouldUpload": {
          "type": "boolean",
          "enum": [
            true
          ]
        },
        "taskId": {
          "type": "string"
        },
        "claimToken": {
          "type": "string"
        },
        "claimExpireAtMs": {
          "type": "integer"
        },
        "fromTsMs": {
          "type": "integer"
        },
        "toTsMs": {
          "type": "integer"
        },
        "maxLines": {
          "type": "integer"
        },
        "maxBytes": {
          "type": "integer"
        },
        "keyId": {
          "type": "string"
        }
      }
    }
  ]
} as const;

export type LogPullTaskData = {
  "shouldUpload": false;
} | {
  "shouldUpload": true;
  "taskId": string;
  "claimToken": string;
  "claimExpireAtMs": number;
  "fromTsMs"?: number;
  "toTsMs"?: number;
  "maxLines"?: number;
  "maxBytes"?: number;
  "keyId": string;
};

export const LogAckRequestSchema = {
  "type": "object",
  "required": [
    "status",
    "claimToken"
  ],
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "no_data"
      ]
    },
    "claimToken": {
      "type": "string"
    }
  }
} as const;

export type LogAckRequest = {
  "status": "no_data";
  "claimToken": string;
};

export const LogFailRequestSchema = {
  "type": "object",
  "required": [
    "claimToken",
    "failureReason"
  ],
  "properties": {
    "claimToken": {
      "type": "string"
    },
    "failureReason": {
      "type": "string"
    }
  }
} as const;

export type LogFailRequest = {
  "claimToken": string;
  "failureReason": string;
};

export const LogUploadDataSchema = {
  "type": "object",
  "required": [
    "taskId",
    "acceptedCount",
    "rejectedCount"
  ],
  "properties": {
    "taskId": {
      "type": "string"
    },
    "acceptedCount": {
      "type": "integer"
    },
    "rejectedCount": {
      "type": "integer"
    }
  }
} as const;

export type LogUploadData = {
  "taskId": string;
  "acceptedCount": number;
  "rejectedCount": number;
};

export const LogNoDataAckDataSchema = {
  "type": "object",
  "required": [
    "taskId",
    "status"
  ],
  "properties": {
    "taskId": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "no_data"
      ]
    }
  }
} as const;

export type LogNoDataAckData = {
  "taskId": string;
  "status": "no_data";
};

export const LogFailDataSchema = {
  "type": "object",
  "required": [
    "taskId",
    "status",
    "failedAt",
    "failureReason"
  ],
  "properties": {
    "taskId": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "failed"
      ]
    },
    "failedAt": {
      "type": "string",
      "format": "date-time"
    },
    "failureReason": {
      "type": "string"
    }
  }
} as const;

export type LogFailData = {
  "taskId": string;
  "status": "failed";
  "failedAt": string;
  "failureReason": string;
};

export const NotificationSendRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "recipientUserId",
    "channel"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "recipientUserId": {
      "type": "string"
    },
    "channel": {
      "type": "string",
      "enum": [
        "email",
        "sms",
        "push"
      ]
    },
    "payload": {
      "type": "object",
      "additionalProperties": true
    }
  }
} as const;

export type NotificationSendRequest = {
  "appId": string;
  "recipientUserId": string;
  "channel": "email" | "sms" | "push";
  "payload"?: {
  [key: string]: unknown;
};
};

export const NotificationQueuedDataSchema = {
  "type": "object",
  "required": [
    "queued",
    "notificationJobId"
  ],
  "properties": {
    "queued": {
      "type": "boolean"
    },
    "notificationJobId": {
      "type": "string"
    }
  }
} as const;

export type NotificationQueuedData = {
  "queued": boolean;
  "notificationJobId": string;
};

export const KickoffPublicConfigSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "recommendedPrompts": {
      "type": "array",
      "description": "Shared kickoff recommendation prompt list managed by backend admin config and consumed by the AINovel client.",
      "items": {
        "type": "string"
      }
    }
  }
} as const;

export type KickoffPublicConfig = {
  "recommendedPrompts"?: string[];
  [key: string]: unknown;
};

export const AINovelPublicConfigSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "app": {
      "type": "string",
      "example": "make_ai_novel_great_again"
    },
    "kickoff": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "recommendedPrompts": {
          "type": "array",
          "description": "Shared kickoff recommendation prompt list managed by backend admin config and consumed by the AINovel client.",
          "items": {
            "type": "string"
          }
        }
      }
    }
  }
} as const;

export type AINovelPublicConfig = {
  "app"?: string;
  "kickoff"?: {
  "recommendedPrompts"?: string[];
  [key: string]: unknown;
};
  [key: string]: unknown;
};

export const PublicConfigDataSchema = {
  "type": "object",
  "required": [
    "appId",
    "config"
  ],
  "properties": {
    "appId": {
      "type": "string",
      "example": "ai_novel"
    },
    "config": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "app": {
          "type": "string",
          "example": "make_ai_novel_great_again"
        },
        "kickoff": {
          "type": "object",
          "additionalProperties": true,
          "properties": {
            "recommendedPrompts": {
              "type": "array",
              "description": "Shared kickoff recommendation prompt list managed by backend admin config and consumed by the AINovel client.",
              "items": {
                "type": "string"
              }
            }
          }
        }
      }
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type PublicConfigData = {
  "appId": string;
  "config": {
  "app"?: string;
  "kickoff"?: {
  "recommendedPrompts"?: string[];
  [key: string]: unknown;
};
  [key: string]: unknown;
};
  "updatedAt"?: string;
};

export type AuthSuccessPayload = AuthSessionData;
export type CurrentUserDocument = CurrentUserData;
export type PublicAppConfigDocument = PublicConfigData;
export type QrLoginCreateResult = QrLoginCreateData;
export type QrLoginConfirmResult = QrLoginConfirmData;
export type QrLoginPollResult = QrLoginPollData;
export type FilePresignResult = FilePresignData;
export type FileConfirmResult = FileConfirmData;
export type LogPolicyResult = LogPolicyData;
export type LogPullTaskResult = LogPullTaskData;
export type LogUploadResult = LogUploadData;
export type LogNoDataAckResult = LogNoDataAckData;
export type LogFailResult = LogFailData;

export const GeneratedPublicContractNames = [
  "AINovelPublicConfig",
  "AnalyticsAcceptedData",
  "AnalyticsBatchRequest",
  "AnalyticsEventInput",
  "AuthAcceptedData",
  "AuthSessionData",
  "ChangePasswordRequest",
  "CurrentUserData",
  "EmailCodeRequest",
  "EmailLoginRequest",
  "FileConfirmData",
  "FileConfirmRequest",
  "FilePresignData",
  "FilePresignRequest",
  "KickoffPublicConfig",
  "LogAckRequest",
  "LogFailData",
  "LogFailRequest",
  "LogNoDataAckData",
  "LogPolicyData",
  "LogPullTaskData",
  "LogUploadData",
  "LogoutRequest",
  "NotificationQueuedData",
  "NotificationSendRequest",
  "PasswordLoginRequest",
  "PublicConfigData",
  "QrLoginConfirmData",
  "QrLoginCreateData",
  "QrLoginCreateRequest",
  "QrLoginPollData",
  "RefreshRequest",
  "RegisterRequest",
  "ResetPasswordRequest",
  "SetPasswordRequest",
  "SmsCodeRequest",
  "SmsLoginRequest",
  "UserSummary"
] as const;
