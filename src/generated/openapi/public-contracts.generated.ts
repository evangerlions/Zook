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
      "default": false,
      "description": "Dev/debug-only provider bypass hint. Production App Review should use admin-configured Test Accounts instead."
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

export const OneClickLoginRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "token",
    "gyuid",
    "clientType"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "token": {
      "type": "string",
      "description": "Carrier token returned by the Getui GeYan one-click login SDK."
    },
    "gyuid": {
      "type": "string",
      "description": "Getui GeYan SDK user identifier returned with the one-click login result."
    },
    "clientType": {
      "type": "string",
      "enum": [
        "app",
        "web"
      ]
    },
    "operator": {
      "type": "string",
      "description": "Optional carrier/operator code returned by the SDK."
    },
    "sdkPlatform": {
      "type": "string",
      "description": "Optional SDK platform label such as android, ios, or ohos."
    }
  }
} as const;

export type OneClickLoginRequest = {
  "appId": string;
  "token": string;
  "gyuid": string;
  "clientType": "app" | "web";
  "operator"?: string;
  "sdkPlatform"?: string;
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
      "minLength": 8,
      "maxLength": 64,
      "pattern": "^(?=.*[A-Za-z])(?=.*\\d).*$"
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
      "minLength": 8,
      "maxLength": 64,
      "pattern": "^(?=.*[A-Za-z])(?=.*\\d).*$"
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
      "minLength": 8,
      "maxLength": 64,
      "pattern": "^(?=.*[A-Za-z])(?=.*\\d).*$"
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
      "minLength": 8,
      "maxLength": 64,
      "pattern": "^(?=.*[A-Za-z])(?=.*\\d).*$"
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
    "accountRegion",
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
    "accountRegion": {
      "type": "string",
      "enum": [
        "CN",
        "GLOBAL",
        "UNKNOWN"
      ]
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
  "accountRegion": "CN" | "GLOBAL" | "UNKNOWN";
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
    "confirmed",
    "accountRegion"
  ],
  "properties": {
    "confirmed": {
      "type": "boolean"
    },
    "accountRegion": {
      "type": "string",
      "enum": [
        "CN",
        "GLOBAL",
        "UNKNOWN"
      ]
    }
  }
} as const;

export type QrLoginConfirmData = {
  "confirmed": boolean;
  "accountRegion": "CN" | "GLOBAL" | "UNKNOWN";
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
        "accountRegion",
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
        "accountRegion": {
          "type": "string",
          "enum": [
            "CN",
            "GLOBAL",
            "UNKNOWN"
          ]
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
  "accountRegion": "CN" | "GLOBAL" | "UNKNOWN";
  "user": {
  "id": string;
  "name": string;
  "email"?: string;
  "phone"?: string | null;
  "avatarUrl"?: string | null;
  "hasPassword": boolean;
};
};

export const AccountDeletionRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "confirmation"
  ],
  "additionalProperties": false,
  "properties": {
    "appId": {
      "type": "string",
      "minLength": 1
    },
    "confirmation": {
      "type": "string",
      "const": "DELETE"
    }
  }
} as const;

export type AccountDeletionRequest = {
  "appId": string;
  "confirmation": string;
};

export const AccountDeletionDataSchema = {
  "type": "object",
  "required": [
    "deleted",
    "revokedSessions"
  ],
  "properties": {
    "deleted": {
      "type": "boolean",
      "const": true
    },
    "revokedSessions": {
      "type": "integer",
      "minimum": 0
    }
  }
} as const;

export type AccountDeletionData = {
  "deleted": boolean;
  "revokedSessions": number;
};

export const CurrentUserDataSchema = {
  "type": "object",
  "required": [
    "appId",
    "accountRegion",
    "user"
  ],
  "properties": {
    "appId": {
      "type": "string"
    },
    "accountRegion": {
      "type": "string",
      "enum": [
        "CN",
        "GLOBAL",
        "UNKNOWN"
      ]
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
  "accountRegion": "CN" | "GLOBAL" | "UNKNOWN";
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
      "deprecated": true,
      "description": "Legacy flat kickoff prompt list. New clients use this only for zh-CN compatibility and otherwise select recommendedPromptsI18n by their effective UI locale.",
      "items": {
        "type": "string"
      }
    },
    "recommendedPromptsI18n": {
      "type": "object",
      "description": "Locale-indexed kickoff prompt lists managed by backend admin config. Entries use the 20 supported canonical BCP-47 locale tags. The client selects only its matching locale entry and falls back to packaged locale copy when that entry is absent or invalid.",
      "additionalProperties": false,
      "properties": {
        "en-US": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "zh-CN": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "zh-TW": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "ja-JP": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "es-ES": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "pt-BR": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "ko-KR": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "de-DE": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "fr-FR": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "hi-IN": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "id-ID": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "it-IT": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "tr-TR": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "vi-VN": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "th-TH": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "pl-PL": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "nl-NL": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "sv-SE": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "bn-BD": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "sw-KE": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    }
  }
} as const;

export type KickoffPublicConfig = {
  "recommendedPrompts"?: string[];
  "recommendedPromptsI18n"?: {
  "en-US"?: string[];
  "zh-CN"?: string[];
  "zh-TW"?: string[];
  "ja-JP"?: string[];
  "es-ES"?: string[];
  "pt-BR"?: string[];
  "ko-KR"?: string[];
  "de-DE"?: string[];
  "fr-FR"?: string[];
  "hi-IN"?: string[];
  "id-ID"?: string[];
  "it-IT"?: string[];
  "tr-TR"?: string[];
  "vi-VN"?: string[];
  "th-TH"?: string[];
  "pl-PL"?: string[];
  "nl-NL"?: string[];
  "sv-SE"?: string[];
  "bn-BD"?: string[];
  "sw-KE"?: string[];
};
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
          "deprecated": true,
          "description": "Legacy flat kickoff prompt list. New clients use this only for zh-CN compatibility and otherwise select recommendedPromptsI18n by their effective UI locale.",
          "items": {
            "type": "string"
          }
        },
        "recommendedPromptsI18n": {
          "type": "object",
          "description": "Locale-indexed kickoff prompt lists managed by backend admin config. Entries use the 20 supported canonical BCP-47 locale tags. The client selects only its matching locale entry and falls back to packaged locale copy when that entry is absent or invalid.",
          "additionalProperties": false,
          "properties": {
            "en-US": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "zh-CN": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "zh-TW": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "ja-JP": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "es-ES": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "pt-BR": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "ko-KR": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "de-DE": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "fr-FR": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "hi-IN": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "id-ID": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "it-IT": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "tr-TR": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "vi-VN": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "th-TH": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "pl-PL": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "nl-NL": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "sv-SE": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "bn-BD": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            },
            "sw-KE": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string",
                "minLength": 1
              }
            }
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
  "recommendedPromptsI18n"?: {
  "en-US"?: string[];
  "zh-CN"?: string[];
  "zh-TW"?: string[];
  "ja-JP"?: string[];
  "es-ES"?: string[];
  "pt-BR"?: string[];
  "ko-KR"?: string[];
  "de-DE"?: string[];
  "fr-FR"?: string[];
  "hi-IN"?: string[];
  "id-ID"?: string[];
  "it-IT"?: string[];
  "tr-TR"?: string[];
  "vi-VN"?: string[];
  "th-TH"?: string[];
  "pl-PL"?: string[];
  "nl-NL"?: string[];
  "sv-SE"?: string[];
  "bn-BD"?: string[];
  "sw-KE"?: string[];
};
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
              "deprecated": true,
              "description": "Legacy flat kickoff prompt list. New clients use this only for zh-CN compatibility and otherwise select recommendedPromptsI18n by their effective UI locale.",
              "items": {
                "type": "string"
              }
            },
            "recommendedPromptsI18n": {
              "type": "object",
              "description": "Locale-indexed kickoff prompt lists managed by backend admin config. Entries use the 20 supported canonical BCP-47 locale tags. The client selects only its matching locale entry and falls back to packaged locale copy when that entry is absent or invalid.",
              "additionalProperties": false,
              "properties": {
                "en-US": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "zh-CN": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "zh-TW": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "ja-JP": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "es-ES": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "pt-BR": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "ko-KR": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "de-DE": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "fr-FR": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "hi-IN": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "id-ID": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "it-IT": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "tr-TR": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "vi-VN": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "th-TH": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "pl-PL": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "nl-NL": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "sv-SE": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "bn-BD": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "sw-KE": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                }
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
  "recommendedPromptsI18n"?: {
  "en-US"?: string[];
  "zh-CN"?: string[];
  "zh-TW"?: string[];
  "ja-JP"?: string[];
  "es-ES"?: string[];
  "pt-BR"?: string[];
  "ko-KR"?: string[];
  "de-DE"?: string[];
  "fr-FR"?: string[];
  "hi-IN"?: string[];
  "id-ID"?: string[];
  "it-IT"?: string[];
  "tr-TR"?: string[];
  "vi-VN"?: string[];
  "th-TH"?: string[];
  "pl-PL"?: string[];
  "nl-NL"?: string[];
  "sv-SE"?: string[];
  "bn-BD"?: string[];
  "sw-KE"?: string[];
};
  [key: string]: unknown;
};
  [key: string]: unknown;
};
  "updatedAt"?: string;
};

export const AiNovelStatisticsDataSchema = {
  "type": "object",
  "required": [
    "timezone",
    "generatedAt",
    "overview",
    "recentActivity",
    "writingTrend",
    "summaryCard"
  ],
  "properties": {
    "timezone": {
      "type": "string",
      "example": "Asia/Shanghai"
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time"
    },
    "overview": {
      "type": "object",
      "required": [
        "totalWorks",
        "totalWords",
        "totalChapters",
        "activeWritingDays"
      ],
      "properties": {
        "totalWorks": {
          "type": "integer",
          "minimum": 0
        },
        "totalWords": {
          "type": "integer",
          "minimum": 0
        },
        "totalChapters": {
          "type": "integer",
          "minimum": 0
        },
        "activeWritingDays": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "recentActivity": {
      "type": "object",
      "required": [
        "wordsToday",
        "wordsThisMonth",
        "tokensToday",
        "tokensThisMonth",
        "activeWritingDaysLast30Days"
      ],
      "properties": {
        "wordsToday": {
          "type": "integer",
          "minimum": 0
        },
        "wordsThisMonth": {
          "type": "integer",
          "minimum": 0
        },
        "tokensToday": {
          "type": "integer",
          "minimum": 0
        },
        "tokensThisMonth": {
          "type": "integer",
          "minimum": 0
        },
        "activeWritingDaysLast30Days": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "writingTrend": {
      "type": "object",
      "required": [
        "days"
      ],
      "properties": {
        "days": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "date",
              "words",
              "tokens",
              "active"
            ],
            "properties": {
              "date": {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
              },
              "words": {
                "type": "integer",
                "minimum": 0
              },
              "tokens": {
                "type": "integer",
                "minimum": 0
              },
              "active": {
                "type": "boolean"
              }
            }
          }
        }
      }
    },
    "summaryCard": {
      "type": "object",
      "required": [
        "totalWords",
        "totalTokens"
      ],
      "properties": {
        "totalWords": {
          "type": "integer",
          "minimum": 0
        },
        "totalTokens": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  }
} as const;

export type AiNovelStatisticsData = {
  "timezone": string;
  "generatedAt": string;
  "overview": {
  "totalWorks": number;
  "totalWords": number;
  "totalChapters": number;
  "activeWritingDays": number;
};
  "recentActivity": {
  "wordsToday": number;
  "wordsThisMonth": number;
  "tokensToday": number;
  "tokensThisMonth": number;
  "activeWritingDaysLast30Days": number;
};
  "writingTrend": {
  "days": {
  "date": string;
  "words": number;
  "tokens": number;
  "active": boolean;
}[];
};
  "summaryCard": {
  "totalWords": number;
  "totalTokens": number;
};
};

export const AiNovelStatisticsSnapshotRequestSchema = {
  "type": "object",
  "required": [
    "accountId",
    "totalWorks",
    "totalWords",
    "totalChapters",
    "activeWritingDays"
  ],
  "properties": {
    "accountId": {
      "type": "string",
      "minLength": 1,
      "description": "Expected authenticated account. Zook rejects a mismatch."
    },
    "totalWorks": {
      "type": "integer",
      "minimum": 0
    },
    "totalWords": {
      "type": "integer",
      "minimum": 0
    },
    "totalChapters": {
      "type": "integer",
      "minimum": 0
    },
    "activeWritingDays": {
      "type": "integer",
      "minimum": 0
    },
    "daily": {
      "type": "array",
      "maxItems": 400,
      "uniqueItems": true,
      "items": {
        "type": "object",
        "required": [
          "date",
          "words"
        ],
        "properties": {
          "date": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
          },
          "words": {
            "type": "integer",
            "minimum": 0
          },
          "active": {
            "type": "boolean"
          }
        }
      }
    }
  }
} as const;

export type AiNovelStatisticsSnapshotRequest = {
  "accountId": string;
  "totalWorks": number;
  "totalWords": number;
  "totalChapters": number;
  "activeWritingDays": number;
  "daily"?: {
  "date": string;
  "words": number;
  "active"?: boolean;
}[];
};

export const AiNovelStatisticsSnapshotResponseSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data"
  ],
  "properties": {
    "code": {
      "type": "string",
      "example": "OK"
    },
    "message": {
      "type": "string",
      "example": "success"
    },
    "data": {
      "type": "object",
      "required": [
        "accepted",
        "updatedAt"
      ],
      "properties": {
        "accepted": {
          "type": "boolean",
          "const": true
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "requestId": {
      "type": "string"
    }
  }
} as const;

export type AiNovelStatisticsSnapshotResponse = {
  "code": string;
  "message": string;
  "data": {
  "accepted": boolean;
  "updatedAt": string;
};
  "requestId"?: string;
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
  "AccountDeletionData",
  "AccountDeletionRequest",
  "AiNovelStatisticsData",
  "AiNovelStatisticsSnapshotRequest",
  "AiNovelStatisticsSnapshotResponse",
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
  "OneClickLoginRequest",
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
