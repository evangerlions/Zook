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

// BEGIN FROGSLEEP GENERATED CONTRACTS
export const FrogSleepPasswordLoginRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "account": {
      "type": "string"
    },
    "identifier": {
      "type": "string"
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "password": {
      "type": "string"
    }
  },
  "anyOf": [
    {
      "required": [
        "account",
        "password"
      ]
    },
    {
      "required": [
        "identifier",
        "password"
      ]
    },
    {
      "required": [
        "email",
        "password"
      ]
    }
  ]
} as const;

export type FrogSleepPasswordLoginRequest = (
{
  "account": string;
  "identifier"?: string;
  "email"?: string;
  "password": string;
  [key: string]: unknown;
}
) | (
{
  "account"?: string;
  "identifier": string;
  "email"?: string;
  "password": string;
  [key: string]: unknown;
}
) | (
{
  "account"?: string;
  "identifier"?: string;
  "email": string;
  "password": string;
  [key: string]: unknown;
}
);

export const FrogSleepEmailCodeRequestSchema = {
  "type": "object",
  "required": [
    "email"
  ],
  "additionalProperties": true,
  "properties": {
    "email": {
      "type": "string",
      "format": "email"
    }
  }
} as const;

export type FrogSleepEmailCodeRequest = {
  "email": string;
  [key: string]: unknown;
};

export const FrogSleepEmailLoginRequestSchema = {
  "type": "object",
  "required": [
    "email"
  ],
  "additionalProperties": true,
  "properties": {
    "email": {
      "type": "string",
      "format": "email"
    },
    "code": {
      "type": "string"
    },
    "email_code": {
      "type": "string"
    },
    "emailCode": {
      "type": "string"
    },
    "verification_id": {
      "type": "string"
    },
    "verificationId": {
      "type": "string"
    }
  }
} as const;

export type FrogSleepEmailLoginRequest = {
  "email": string;
  "code"?: string;
  "email_code"?: string;
  "emailCode"?: string;
  "verification_id"?: string;
  "verificationId"?: string;
  [key: string]: unknown;
};

export const FrogSleepEmailRegisterRequestSchema = {
  "type": "object",
  "required": [
    "email"
  ],
  "additionalProperties": true,
  "properties": {
    "email": {
      "type": "string",
      "format": "email"
    },
    "password": {
      "type": "string"
    },
    "code": {
      "type": "string"
    },
    "email_code": {
      "type": "string"
    },
    "emailCode": {
      "type": "string"
    },
    "verification_id": {
      "type": "string"
    },
    "verificationId": {
      "type": "string"
    }
  }
} as const;

export type FrogSleepEmailRegisterRequest = {
  "email": string;
  "password"?: string;
  "code"?: string;
  "email_code"?: string;
  "emailCode"?: string;
  "verification_id"?: string;
  "verificationId"?: string;
  [key: string]: unknown;
};

export const FrogSleepPasswordResetRequestSchema = {
  "type": "object",
  "required": [
    "email"
  ],
  "additionalProperties": true,
  "properties": {
    "email": {
      "type": "string",
      "format": "email"
    }
  }
} as const;

export type FrogSleepPasswordResetRequest = {
  "email": string;
  [key: string]: unknown;
};

export const FrogSleepPasswordResetConfirmRequestSchema = {
  "type": "object",
  "required": [
    "email"
  ],
  "additionalProperties": true,
  "properties": {
    "email": {
      "type": "string",
      "format": "email"
    },
    "code": {
      "type": "string"
    },
    "email_code": {
      "type": "string"
    },
    "emailCode": {
      "type": "string"
    },
    "verification_id": {
      "type": "string"
    },
    "verificationId": {
      "type": "string"
    },
    "password": {
      "type": "string"
    },
    "new_password": {
      "type": "string"
    },
    "newPassword": {
      "type": "string"
    }
  }
} as const;

export type FrogSleepPasswordResetConfirmRequest = {
  "email": string;
  "code"?: string;
  "email_code"?: string;
  "emailCode"?: string;
  "verification_id"?: string;
  "verificationId"?: string;
  "password"?: string;
  "new_password"?: string;
  "newPassword"?: string;
  [key: string]: unknown;
};

export const FrogSleepPasswordChangeRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "current_password": {
      "type": "string"
    },
    "currentPassword": {
      "type": "string"
    },
    "new_password": {
      "type": "string"
    },
    "newPassword": {
      "type": "string"
    },
    "password": {
      "type": "string"
    }
  },
  "allOf": [
    {
      "anyOf": [
        {
          "required": [
            "current_password"
          ]
        },
        {
          "required": [
            "currentPassword"
          ]
        }
      ]
    },
    {
      "anyOf": [
        {
          "required": [
            "new_password"
          ]
        },
        {
          "required": [
            "newPassword"
          ]
        },
        {
          "required": [
            "password"
          ]
        }
      ]
    }
  ]
} as const;

export type FrogSleepPasswordChangeRequest = (
{
  "current_password"?: string;
  "currentPassword"?: string;
  "new_password"?: string;
  "newPassword"?: string;
  "password"?: string;
  [key: string]: unknown;
}
) & (
(
{
  "current_password": string;
  "currentPassword"?: string;
  "new_password"?: string;
  "newPassword"?: string;
  "password"?: string;
  [key: string]: unknown;
}
) | (
{
  "current_password"?: string;
  "currentPassword": string;
  "new_password"?: string;
  "newPassword"?: string;
  "password"?: string;
  [key: string]: unknown;
}
)
) & (
(
{
  "current_password"?: string;
  "currentPassword"?: string;
  "new_password": string;
  "newPassword"?: string;
  "password"?: string;
  [key: string]: unknown;
}
) | (
{
  "current_password"?: string;
  "currentPassword"?: string;
  "new_password"?: string;
  "newPassword": string;
  "password"?: string;
  [key: string]: unknown;
}
) | (
{
  "current_password"?: string;
  "currentPassword"?: string;
  "new_password"?: string;
  "newPassword"?: string;
  "password": string;
  [key: string]: unknown;
}
)
);

export const FrogSleepTokenRefreshRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "refresh_token": {
      "type": "string"
    },
    "refreshToken": {
      "type": "string"
    }
  }
} as const;

export type FrogSleepTokenRefreshRequest = {
  "refresh_token"?: string;
  "refreshToken"?: string;
  [key: string]: unknown;
};

export const FrogSleepDeviceRegisterRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "device_id": {
      "type": "string"
    },
    "deviceId": {
      "type": "string"
    },
    "platform": {
      "type": "string",
      "enum": [
        "ios",
        "android",
        "web"
      ]
    },
    "push_token": {
      "type": "string"
    },
    "pushToken": {
      "type": "string"
    },
    "token": {
      "type": "string"
    },
    "app_version": {
      "type": "string"
    },
    "appVersion": {
      "type": "string"
    },
    "timezone": {
      "type": "string"
    },
    "push_enabled": {
      "type": "boolean"
    },
    "pushEnabled": {
      "type": "boolean"
    }
  },
  "anyOf": [
    {
      "required": [
        "push_token"
      ]
    },
    {
      "required": [
        "pushToken"
      ]
    },
    {
      "required": [
        "token"
      ]
    }
  ]
} as const;

export type FrogSleepDeviceRegisterRequest = (
{
  "device_id"?: string;
  "deviceId"?: string;
  "platform"?: "ios" | "android" | "web";
  "push_token": string;
  "pushToken"?: string;
  "token"?: string;
  "app_version"?: string;
  "appVersion"?: string;
  "timezone"?: string;
  "push_enabled"?: boolean;
  "pushEnabled"?: boolean;
  [key: string]: unknown;
}
) | (
{
  "device_id"?: string;
  "deviceId"?: string;
  "platform"?: "ios" | "android" | "web";
  "push_token"?: string;
  "pushToken": string;
  "token"?: string;
  "app_version"?: string;
  "appVersion"?: string;
  "timezone"?: string;
  "push_enabled"?: boolean;
  "pushEnabled"?: boolean;
  [key: string]: unknown;
}
) | (
{
  "device_id"?: string;
  "deviceId"?: string;
  "platform"?: "ios" | "android" | "web";
  "push_token"?: string;
  "pushToken"?: string;
  "token": string;
  "app_version"?: string;
  "appVersion"?: string;
  "timezone"?: string;
  "push_enabled"?: boolean;
  "pushEnabled"?: boolean;
  [key: string]: unknown;
}
);

export const FrogSleepInviteCreateRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "invitee": {
      "type": "string"
    },
    "target": {
      "type": "string"
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "user_id": {
      "type": "string"
    },
    "userId": {
      "type": "string"
    },
    "role": {
      "type": "string"
    },
    "custom_label": {
      "type": "string"
    },
    "customLabel": {
      "type": "string"
    }
  },
  "anyOf": [
    {
      "required": [
        "invitee"
      ]
    },
    {
      "required": [
        "target"
      ]
    },
    {
      "required": [
        "email"
      ]
    },
    {
      "required": [
        "user_id"
      ]
    },
    {
      "required": [
        "userId"
      ]
    }
  ]
} as const;

export type FrogSleepInviteCreateRequest = (
{
  "invitee": string;
  "target"?: string;
  "email"?: string;
  "user_id"?: string;
  "userId"?: string;
  "role"?: string;
  "custom_label"?: string;
  "customLabel"?: string;
  [key: string]: unknown;
}
) | (
{
  "invitee"?: string;
  "target": string;
  "email"?: string;
  "user_id"?: string;
  "userId"?: string;
  "role"?: string;
  "custom_label"?: string;
  "customLabel"?: string;
  [key: string]: unknown;
}
) | (
{
  "invitee"?: string;
  "target"?: string;
  "email": string;
  "user_id"?: string;
  "userId"?: string;
  "role"?: string;
  "custom_label"?: string;
  "customLabel"?: string;
  [key: string]: unknown;
}
) | (
{
  "invitee"?: string;
  "target"?: string;
  "email"?: string;
  "user_id": string;
  "userId"?: string;
  "role"?: string;
  "custom_label"?: string;
  "customLabel"?: string;
  [key: string]: unknown;
}
) | (
{
  "invitee"?: string;
  "target"?: string;
  "email"?: string;
  "user_id"?: string;
  "userId": string;
  "role"?: string;
  "custom_label"?: string;
  "customLabel"?: string;
  [key: string]: unknown;
}
);

export const FrogSleepInviteAcceptRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "code": {
      "type": "string"
    },
    "token": {
      "type": "string"
    },
    "invite_id": {
      "type": "string"
    },
    "inviteId": {
      "type": "string"
    }
  },
  "anyOf": [
    {
      "required": [
        "code"
      ]
    },
    {
      "required": [
        "token"
      ]
    },
    {
      "required": [
        "invite_id"
      ]
    },
    {
      "required": [
        "inviteId"
      ]
    }
  ]
} as const;

export type FrogSleepInviteAcceptRequest = (
{
  "code": string;
  "token"?: string;
  "invite_id"?: string;
  "inviteId"?: string;
  [key: string]: unknown;
}
) | (
{
  "code"?: string;
  "token": string;
  "invite_id"?: string;
  "inviteId"?: string;
  [key: string]: unknown;
}
) | (
{
  "code"?: string;
  "token"?: string;
  "invite_id": string;
  "inviteId"?: string;
  [key: string]: unknown;
}
) | (
{
  "code"?: string;
  "token"?: string;
  "invite_id"?: string;
  "inviteId": string;
  [key: string]: unknown;
}
);

export const BuddyInvitationCreateRequestSchema = {
  "type": "object",
  "required": [
    "target",
    "domains"
  ],
  "additionalProperties": false,
  "properties": {
    "target": {
      "type": "string",
      "minLength": 1
    },
    "domains": {
      "type": "array",
      "minItems": 1,
      "maxItems": 2,
      "uniqueItems": true,
      "items": {
        "type": "string",
        "enum": [
          "sleep",
          "focus"
        ]
      }
    }
  }
} as const;

export type BuddyInvitationCreateRequest = {
  "target": string;
  "domains": "sleep" | "focus"[];
};

export const BuddyInvitationResponseRequestSchema = {
  "type": "object",
  "required": [
    "expected_version",
    "idempotency_key"
  ],
  "additionalProperties": false,
  "properties": {
    "expected_version": {
      "type": "integer",
      "minimum": 1
    },
    "idempotency_key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "sharing_categories": {
      "type": "array",
      "uniqueItems": true,
      "items": {
        "type": "string",
        "enum": [
          "presence",
          "daily_summary",
          "weekly_trend",
          "shared_activity"
        ]
      }
    }
  }
} as const;

export type BuddyInvitationResponseRequest = {
  "expected_version": number;
  "idempotency_key": string;
  "sharing_categories"?: "presence" | "daily_summary" | "weekly_trend" | "shared_activity"[];
};

export const BuddySharingGrantUpdateRequestSchema = {
  "type": "object",
  "required": [
    "state",
    "expected_version"
  ],
  "additionalProperties": false,
  "properties": {
    "state": {
      "type": "string",
      "enum": [
        "granted",
        "revoked"
      ]
    },
    "expected_version": {
      "type": "integer",
      "minimum": 1
    }
  }
} as const;

export type BuddySharingGrantUpdateRequest = {
  "state": "granted" | "revoked";
  "expected_version": number;
};

export const BuddyNotificationPreferencesRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "enabled": {
      "type": "boolean"
    },
    "disabled_categories": {
      "type": "array",
      "uniqueItems": true,
      "items": {
        "type": "string",
        "enum": [
          "invitations",
          "interactions",
          "activities",
          "goals",
          "reports"
        ]
      }
    },
    "quiet_start_minute": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1439
    },
    "quiet_end_minute": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1439
    },
    "timezone_offset_minutes": {
      "type": "integer",
      "minimum": -720,
      "maximum": 840
    },
    "cooldown_minutes": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1440
    },
    "daily_budget": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100
    }
  }
} as const;

export type BuddyNotificationPreferencesRequest = {
  "enabled"?: boolean;
  "disabled_categories"?: "invitations" | "interactions" | "activities" | "goals" | "reports"[];
  "quiet_start_minute"?: number;
  "quiet_end_minute"?: number;
  "timezone_offset_minutes"?: number;
  "cooldown_minutes"?: number;
  "daily_budget"?: number;
};

export const BuddyStructuredShareRequestSchema = {
  "type": "object",
  "required": [
    "relationship_id",
    "type",
    "idempotency_key",
    "snapshot"
  ],
  "additionalProperties": false,
  "properties": {
    "relationship_id": {
      "type": "string",
      "minLength": 1
    },
    "type": {
      "type": "string",
      "enum": [
        "focus_completion",
        "daily_focus_summary",
        "sleep_summary",
        "weekly_progress",
        "joint_goal_update"
      ]
    },
    "idempotency_key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "snapshot": {
      "type": "object",
      "additionalProperties": true
    },
    "expires_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type BuddyStructuredShareRequest = {
  "relationship_id": string;
  "type": "focus_completion" | "daily_focus_summary" | "sleep_summary" | "weekly_progress" | "joint_goal_update";
  "idempotency_key": string;
  "snapshot": {
  [key: string]: unknown;
};
  "expires_at"?: string;
};

export const BuddyInteractionRequestSchema = {
  "type": "object",
  "required": [
    "relationship_id",
    "type",
    "idempotency_key"
  ],
  "additionalProperties": false,
  "properties": {
    "relationship_id": {
      "type": "string",
      "minLength": 1
    },
    "type": {
      "type": "string",
      "enum": [
        "encouragement",
        "praise",
        "support",
        "join_next_time",
        "tonight_together"
      ]
    },
    "idempotency_key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "context_id": {
      "type": "string"
    }
  }
} as const;

export type BuddyInteractionRequest = {
  "relationship_id": string;
  "type": "encouragement" | "praise" | "support" | "join_next_time" | "tonight_together";
  "idempotency_key": string;
  "context_id"?: string;
};

export const BuddyJointActivityRequestSchema = {
  "type": "object",
  "required": [
    "relationship_id",
    "type",
    "idempotency_key"
  ],
  "additionalProperties": false,
  "properties": {
    "relationship_id": {
      "type": "string",
      "minLength": 1
    },
    "type": {
      "type": "string",
      "enum": [
        "joint_focus",
        "tonight_together"
      ]
    },
    "idempotency_key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "starts_at": {
      "type": "string",
      "format": "date-time"
    },
    "planned_minutes": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1440
    }
  }
} as const;

export type BuddyJointActivityRequest = {
  "relationship_id": string;
  "type": "joint_focus" | "tonight_together";
  "idempotency_key": string;
  "starts_at"?: string;
  "planned_minutes"?: number;
};

export const FrogSleepSleepPreferencesRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "guard_level": {
      "type": "string",
      "enum": [
        "relaxed",
        "standard",
        "strict"
      ]
    },
    "guardLevel": {
      "type": "string",
      "enum": [
        "relaxed",
        "standard",
        "strict"
      ]
    },
    "visibility_scope": {
      "type": "string",
      "enum": [
        "summary",
        "detailed",
        "private"
      ]
    },
    "visibilityScope": {
      "type": "string",
      "enum": [
        "summary",
        "detailed",
        "private"
      ]
    },
    "mute_for_tonight": {
      "type": "boolean"
    },
    "muteForTonight": {
      "type": "boolean"
    },
    "allow_morning_summary_push": {
      "type": "boolean"
    },
    "allowMorningSummaryPush": {
      "type": "boolean"
    },
    "allow_recovery_nudges": {
      "type": "boolean"
    },
    "allowRecoveryNudges": {
      "type": "boolean"
    }
  }
} as const;

export type FrogSleepSleepPreferencesRequest = {
  "guard_level"?: "relaxed" | "standard" | "strict";
  "guardLevel"?: "relaxed" | "standard" | "strict";
  "visibility_scope"?: "summary" | "detailed" | "private";
  "visibilityScope"?: "summary" | "detailed" | "private";
  "mute_for_tonight"?: boolean;
  "muteForTonight"?: boolean;
  "allow_morning_summary_push"?: boolean;
  "allowMorningSummaryPush"?: boolean;
  "allow_recovery_nudges"?: boolean;
  "allowRecoveryNudges"?: boolean;
  [key: string]: unknown;
};

export const FrogSleepSharedSleepSessionRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "relationship_id": {
      "type": "string"
    },
    "relationshipId": {
      "type": "string"
    },
    "date_anchor": {
      "type": "string",
      "format": "date"
    },
    "dateAnchor": {
      "type": "string",
      "format": "date"
    }
  },
  "anyOf": [
    {
      "required": [
        "relationship_id"
      ]
    },
    {
      "required": [
        "relationshipId"
      ]
    }
  ]
} as const;

export type FrogSleepSharedSleepSessionRequest = (
{
  "relationship_id": string;
  "relationshipId"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  [key: string]: unknown;
}
) | (
{
  "relationship_id"?: string;
  "relationshipId": string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  [key: string]: unknown;
}
);

export const FrogSleepSharedSleepEventRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "event_type": {
      "type": "string",
      "enum": [
        "interrupted",
        "returned",
        "paused_tonight",
        "morning_completed"
      ]
    },
    "eventType": {
      "type": "string",
      "enum": [
        "interrupted",
        "returned",
        "paused_tonight",
        "morning_completed"
      ]
    },
    "occurred_at": {
      "type": "string",
      "format": "date-time"
    },
    "occurredAt": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "anyOf": [
    {
      "required": [
        "event_type"
      ]
    },
    {
      "required": [
        "eventType"
      ]
    }
  ]
} as const;

export type FrogSleepSharedSleepEventRequest = (
{
  "event_type": "interrupted" | "returned" | "paused_tonight" | "morning_completed";
  "eventType"?: "interrupted" | "returned" | "paused_tonight" | "morning_completed";
  "occurred_at"?: string;
  "occurredAt"?: string;
  "metadata"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) | (
{
  "event_type"?: "interrupted" | "returned" | "paused_tonight" | "morning_completed";
  "eventType": "interrupted" | "returned" | "paused_tonight" | "morning_completed";
  "occurred_at"?: string;
  "occurredAt"?: string;
  "metadata"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
);

export const FrogSleepFocusProfileRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "display_name": {
      "type": "string"
    },
    "displayName": {
      "type": "string"
    },
    "study_types": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "scene_tags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "active_period": {
      "type": "string"
    },
    "activePeriod": {
      "type": "string"
    },
    "strictness": {
      "type": "string"
    },
    "gender_identity": {
      "type": "string"
    },
    "genderIdentity": {
      "type": "string"
    },
    "gender_preference": {
      "type": "string"
    },
    "genderPreference": {
      "type": "string"
    },
    "bio": {
      "type": "string"
    },
    "matching_consent": {
      "type": "boolean"
    },
    "matchingConsent": {
      "type": "boolean"
    }
  },
  "anyOf": [
    {
      "required": [
        "display_name"
      ]
    },
    {
      "required": [
        "displayName"
      ]
    }
  ]
} as const;

export type FrogSleepFocusProfileRequest = (
{
  "display_name": string;
  "displayName"?: string;
  "study_types"?: string[];
  "scene_tags"?: string[];
  "active_period"?: string;
  "activePeriod"?: string;
  "strictness"?: string;
  "gender_identity"?: string;
  "genderIdentity"?: string;
  "gender_preference"?: string;
  "genderPreference"?: string;
  "bio"?: string;
  "matching_consent"?: boolean;
  "matchingConsent"?: boolean;
  [key: string]: unknown;
}
) | (
{
  "display_name"?: string;
  "displayName": string;
  "study_types"?: string[];
  "scene_tags"?: string[];
  "active_period"?: string;
  "activePeriod"?: string;
  "strictness"?: string;
  "gender_identity"?: string;
  "genderIdentity"?: string;
  "gender_preference"?: string;
  "genderPreference"?: string;
  "bio"?: string;
  "matching_consent"?: boolean;
  "matchingConsent"?: boolean;
  [key: string]: unknown;
}
);

export const FrogSleepFocusSessionRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "startedAt": {
      "type": "string",
      "format": "date-time"
    },
    "start_time": {
      "type": "string",
      "format": "date-time"
    },
    "startTime": {
      "type": "string",
      "format": "date-time"
    },
    "ended_at": {
      "type": "string",
      "format": "date-time"
    },
    "endedAt": {
      "type": "string",
      "format": "date-time"
    },
    "end_time": {
      "type": "string",
      "format": "date-time"
    },
    "endTime": {
      "type": "string",
      "format": "date-time"
    },
    "planned_minutes": {
      "type": "number"
    },
    "plannedMinutes": {
      "type": "number"
    },
    "actual_minutes": {
      "type": "number"
    },
    "actualMinutes": {
      "type": "number"
    },
    "minutes": {
      "type": "number"
    },
    "interrupt_count": {
      "type": "number"
    },
    "interruptCount": {
      "type": "number"
    },
    "relationship_id": {
      "type": "string"
    },
    "relationshipId": {
      "type": "string"
    },
    "room_id": {
      "type": "string"
    },
    "roomId": {
      "type": "string"
    },
    "goal_tag": {
      "type": "string"
    },
    "goalTag": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "completed",
        "abandoned",
        "interrupted",
        "cancelled",
        "focusing",
        "recent",
        "idle",
        "stale"
      ]
    }
  }
} as const;

export type FrogSleepFocusSessionRequest = {
  "started_at"?: string;
  "startedAt"?: string;
  "start_time"?: string;
  "startTime"?: string;
  "ended_at"?: string;
  "endedAt"?: string;
  "end_time"?: string;
  "endTime"?: string;
  "planned_minutes"?: number;
  "plannedMinutes"?: number;
  "actual_minutes"?: number;
  "actualMinutes"?: number;
  "minutes"?: number;
  "interrupt_count"?: number;
  "interruptCount"?: number;
  "relationship_id"?: string;
  "relationshipId"?: string;
  "room_id"?: string;
  "roomId"?: string;
  "goal_tag"?: string;
  "goalTag"?: string;
  "status"?: "completed" | "abandoned" | "interrupted" | "cancelled" | "focusing" | "recent" | "idle" | "stale";
  [key: string]: unknown;
};

export const FrogSleepFocusAchievementNotifyRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "milestone_id": {
      "type": "string"
    },
    "milestoneId": {
      "type": "string"
    }
  },
  "anyOf": [
    {
      "required": [
        "milestone_id"
      ]
    },
    {
      "required": [
        "milestoneId"
      ]
    }
  ]
} as const;

export type FrogSleepFocusAchievementNotifyRequest = (
{
  "milestone_id": string;
  "milestoneId"?: string;
  [key: string]: unknown;
}
) | (
{
  "milestone_id"?: string;
  "milestoneId": string;
  [key: string]: unknown;
}
);

export const FrogSleepFocusMessageRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "receiver_user_id": {
      "type": "string"
    },
    "receiverUserId": {
      "type": "string"
    },
    "template_key": {
      "type": "string"
    },
    "templateKey": {
      "type": "string"
    },
    "custom_text": {
      "type": "string",
      "maxLength": 280
    },
    "customText": {
      "type": "string",
      "maxLength": 280
    },
    "context_session_type": {
      "type": "string"
    },
    "contextSessionType": {
      "type": "string"
    },
    "context_session_id": {
      "type": "string"
    },
    "contextSessionId": {
      "type": "string"
    }
  },
  "allOf": [
    {
      "anyOf": [
        {
          "required": [
            "receiver_user_id"
          ]
        },
        {
          "required": [
            "receiverUserId"
          ]
        }
      ]
    },
    {
      "anyOf": [
        {
          "required": [
            "template_key"
          ]
        },
        {
          "required": [
            "templateKey"
          ]
        },
        {
          "required": [
            "custom_text"
          ]
        },
        {
          "required": [
            "customText"
          ]
        }
      ]
    }
  ]
} as const;

export type FrogSleepFocusMessageRequest = (
{
  "receiver_user_id"?: string;
  "receiverUserId"?: string;
  "template_key"?: string;
  "templateKey"?: string;
  "custom_text"?: string;
  "customText"?: string;
  "context_session_type"?: string;
  "contextSessionType"?: string;
  "context_session_id"?: string;
  "contextSessionId"?: string;
  [key: string]: unknown;
}
) & (
(
{
  "receiver_user_id": string;
  "receiverUserId"?: string;
  "template_key"?: string;
  "templateKey"?: string;
  "custom_text"?: string;
  "customText"?: string;
  "context_session_type"?: string;
  "contextSessionType"?: string;
  "context_session_id"?: string;
  "contextSessionId"?: string;
  [key: string]: unknown;
}
) | (
{
  "receiver_user_id"?: string;
  "receiverUserId": string;
  "template_key"?: string;
  "templateKey"?: string;
  "custom_text"?: string;
  "customText"?: string;
  "context_session_type"?: string;
  "contextSessionType"?: string;
  "context_session_id"?: string;
  "contextSessionId"?: string;
  [key: string]: unknown;
}
)
) & (
(
{
  "receiver_user_id"?: string;
  "receiverUserId"?: string;
  "template_key": string;
  "templateKey"?: string;
  "custom_text"?: string;
  "customText"?: string;
  "context_session_type"?: string;
  "contextSessionType"?: string;
  "context_session_id"?: string;
  "contextSessionId"?: string;
  [key: string]: unknown;
}
) | (
{
  "receiver_user_id"?: string;
  "receiverUserId"?: string;
  "template_key"?: string;
  "templateKey": string;
  "custom_text"?: string;
  "customText"?: string;
  "context_session_type"?: string;
  "contextSessionType"?: string;
  "context_session_id"?: string;
  "contextSessionId"?: string;
  [key: string]: unknown;
}
) | (
{
  "receiver_user_id"?: string;
  "receiverUserId"?: string;
  "template_key"?: string;
  "templateKey"?: string;
  "custom_text": string;
  "customText"?: string;
  "context_session_type"?: string;
  "contextSessionType"?: string;
  "context_session_id"?: string;
  "contextSessionId"?: string;
  [key: string]: unknown;
}
) | (
{
  "receiver_user_id"?: string;
  "receiverUserId"?: string;
  "template_key"?: string;
  "templateKey"?: string;
  "custom_text"?: string;
  "customText": string;
  "context_session_type"?: string;
  "contextSessionType"?: string;
  "context_session_id"?: string;
  "contextSessionId"?: string;
  [key: string]: unknown;
}
)
);

export const FrogSleepSleepReportRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "snapshot_id": {
      "type": "string"
    },
    "report_id": {
      "type": "string"
    },
    "id": {
      "type": "string"
    },
    "schema_version": {
      "type": "string"
    },
    "version": {
      "type": "string"
    },
    "recorded_at": {
      "type": "string",
      "format": "date-time"
    },
    "recordedAt": {
      "type": "string",
      "format": "date-time"
    },
    "date_anchor": {
      "type": "string",
      "format": "date"
    },
    "dateAnchor": {
      "type": "string",
      "format": "date"
    },
    "report_type": {
      "type": "string"
    },
    "reportType": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "additionalProperties": true
    },
    "report": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "allOf": [
    {
      "anyOf": [
        {
          "required": [
            "snapshot_id"
          ]
        },
        {
          "required": [
            "report_id"
          ]
        },
        {
          "required": [
            "id"
          ]
        }
      ]
    },
    {
      "anyOf": [
        {
          "required": [
            "schema_version"
          ]
        },
        {
          "required": [
            "version"
          ]
        }
      ]
    },
    {
      "anyOf": [
        {
          "required": [
            "recorded_at"
          ]
        },
        {
          "required": [
            "recordedAt"
          ]
        }
      ]
    },
    {
      "anyOf": [
        {
          "required": [
            "data"
          ]
        },
        {
          "required": [
            "report"
          ]
        }
      ]
    }
  ]
} as const;

export type FrogSleepSleepReportRequest = (
{
  "snapshot_id"?: string;
  "report_id"?: string;
  "id"?: string;
  "schema_version"?: string;
  "version"?: string;
  "recorded_at"?: string;
  "recordedAt"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data"?: {
  [key: string]: unknown;
};
  "report"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) & (
(
{
  "snapshot_id": string;
  "report_id"?: string;
  "id"?: string;
  "schema_version"?: string;
  "version"?: string;
  "recorded_at"?: string;
  "recordedAt"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data"?: {
  [key: string]: unknown;
};
  "report"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) | (
{
  "snapshot_id"?: string;
  "report_id": string;
  "id"?: string;
  "schema_version"?: string;
  "version"?: string;
  "recorded_at"?: string;
  "recordedAt"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data"?: {
  [key: string]: unknown;
};
  "report"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) | (
{
  "snapshot_id"?: string;
  "report_id"?: string;
  "id": string;
  "schema_version"?: string;
  "version"?: string;
  "recorded_at"?: string;
  "recordedAt"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data"?: {
  [key: string]: unknown;
};
  "report"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
)
) & (
(
{
  "snapshot_id"?: string;
  "report_id"?: string;
  "id"?: string;
  "schema_version": string;
  "version"?: string;
  "recorded_at"?: string;
  "recordedAt"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data"?: {
  [key: string]: unknown;
};
  "report"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) | (
{
  "snapshot_id"?: string;
  "report_id"?: string;
  "id"?: string;
  "schema_version"?: string;
  "version": string;
  "recorded_at"?: string;
  "recordedAt"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data"?: {
  [key: string]: unknown;
};
  "report"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
)
) & (
(
{
  "snapshot_id"?: string;
  "report_id"?: string;
  "id"?: string;
  "schema_version"?: string;
  "version"?: string;
  "recorded_at": string;
  "recordedAt"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data"?: {
  [key: string]: unknown;
};
  "report"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) | (
{
  "snapshot_id"?: string;
  "report_id"?: string;
  "id"?: string;
  "schema_version"?: string;
  "version"?: string;
  "recorded_at"?: string;
  "recordedAt": string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data"?: {
  [key: string]: unknown;
};
  "report"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
)
) & (
(
{
  "snapshot_id"?: string;
  "report_id"?: string;
  "id"?: string;
  "schema_version"?: string;
  "version"?: string;
  "recorded_at"?: string;
  "recordedAt"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data": {
  [key: string]: unknown;
};
  "report"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) | (
{
  "snapshot_id"?: string;
  "report_id"?: string;
  "id"?: string;
  "schema_version"?: string;
  "version"?: string;
  "recorded_at"?: string;
  "recordedAt"?: string;
  "date_anchor"?: string;
  "dateAnchor"?: string;
  "report_type"?: string;
  "reportType"?: string;
  "data"?: {
  [key: string]: unknown;
};
  "report": {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
)
);

export const FrogSleepProgressSnapshotRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "schema_version": {
      "type": "string"
    },
    "version": {
      "type": "string"
    },
    "state": {
      "type": "object",
      "additionalProperties": true
    },
    "data": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "allOf": [
    {
      "anyOf": [
        {
          "required": [
            "schema_version"
          ]
        },
        {
          "required": [
            "version"
          ]
        }
      ]
    },
    {
      "anyOf": [
        {
          "required": [
            "state"
          ]
        },
        {
          "required": [
            "data"
          ]
        }
      ]
    }
  ]
} as const;

export type FrogSleepProgressSnapshotRequest = (
{
  "schema_version"?: string;
  "version"?: string;
  "state"?: {
  [key: string]: unknown;
};
  "data"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) & (
(
{
  "schema_version": string;
  "version"?: string;
  "state"?: {
  [key: string]: unknown;
};
  "data"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) | (
{
  "schema_version"?: string;
  "version": string;
  "state"?: {
  [key: string]: unknown;
};
  "data"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
)
) & (
(
{
  "schema_version"?: string;
  "version"?: string;
  "state": {
  [key: string]: unknown;
};
  "data"?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
) | (
{
  "schema_version"?: string;
  "version"?: string;
  "state"?: {
  [key: string]: unknown;
};
  "data": {
  [key: string]: unknown;
};
  [key: string]: unknown;
}
)
);

export const FrogSleepEntitlementDataSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "state": {
      "type": "string",
      "enum": [
        "active",
        "expired",
        "revoked",
        "unknown",
        "free"
      ]
    },
    "plan": {
      "type": "string"
    },
    "source": {
      "type": "string"
    },
    "verified_at": {
      "type": "string",
      "format": "date-time"
    },
    "expires_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type FrogSleepEntitlementData = {
  "state"?: "active" | "expired" | "revoked" | "unknown" | "free";
  "plan"?: string;
  "source"?: string;
  "verified_at"?: string;
  "expires_at"?: string;
  [key: string]: unknown;
};

export const FrogSleepEnvelopeSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data"
  ],
  "additionalProperties": true,
  "properties": {
    "code": {
      "type": "string"
    },
    "message": {
      "type": "string"
    },
    "requestId": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "additionalProperties": true
    }
  }
} as const;

export type FrogSleepEnvelope = {
  "code": string;
  "message": string;
  "requestId"?: string;
  "data": {
  [key: string]: unknown;
};
  [key: string]: unknown;
};

// END FROGSLEEP GENERATED CONTRACTS

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
  "BuddyInteractionRequest",
  "BuddyInvitationCreateRequest",
  "BuddyInvitationResponseRequest",
  "BuddyJointActivityRequest",
  "BuddyNotificationPreferencesRequest",
  "BuddySharingGrantUpdateRequest",
  "BuddyStructuredShareRequest",
  "ChangePasswordRequest",
  "CurrentUserData",
  "EmailCodeRequest",
  "EmailLoginRequest",
  "FileConfirmData",
  "FileConfirmRequest",
  "FilePresignData",
  "FilePresignRequest",
  "FrogSleepDeviceRegisterRequest",
  "FrogSleepEmailCodeRequest",
  "FrogSleepEmailLoginRequest",
  "FrogSleepEmailRegisterRequest",
  "FrogSleepEntitlementData",
  "FrogSleepEnvelope",
  "FrogSleepFocusAchievementNotifyRequest",
  "FrogSleepFocusMessageRequest",
  "FrogSleepFocusProfileRequest",
  "FrogSleepFocusSessionRequest",
  "FrogSleepInviteAcceptRequest",
  "FrogSleepInviteCreateRequest",
  "FrogSleepPasswordChangeRequest",
  "FrogSleepPasswordLoginRequest",
  "FrogSleepPasswordResetConfirmRequest",
  "FrogSleepPasswordResetRequest",
  "FrogSleepProgressSnapshotRequest",
  "FrogSleepSharedSleepEventRequest",
  "FrogSleepSharedSleepSessionRequest",
  "FrogSleepSleepPreferencesRequest",
  "FrogSleepSleepReportRequest",
  "FrogSleepTokenRefreshRequest",
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
