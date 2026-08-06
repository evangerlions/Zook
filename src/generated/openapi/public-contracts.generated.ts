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

export const PasswordSmsCodeRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "phone"
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

export type PasswordSmsCodeRequest = {
  "appId": string;
  "phone": string;
  "phoneNa"?: string;
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

export const ResetPasswordBySmsRequestSchema = {
  "type": "object",
  "required": [
    "appId",
    "phone",
    "smsCode",
    "password",
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

export type ResetPasswordBySmsRequest = {
  "appId": string;
  "phone": string;
  "phoneNa"?: string;
  "smsCode": string;
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

export const RegisterBySmsRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "appId",
    "phone",
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
      "default": "+86"
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

export type RegisterBySmsRequest = {
  "appId": string;
  "phone": string;
  "phoneNa"?: string;
  "smsCode": string;
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
  "events": (
{
  "platform": "web" | "ios" | "android";
  "sessionId": string;
  "pageKey": string;
  "eventName": "page_view" | "page_leave" | "page_heartbeat";
  "durationMs"?: number;
  "occurredAt": string;
  "metadata"?: {
  [key: string]: unknown;
};
}
)[];
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
  "days": (
{
  "date": string;
  "words": number;
  "tokens": number;
  "active": boolean;
}
)[];
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
  "daily"?: (
{
  "date": string;
  "words": number;
  "active"?: boolean;
}
)[];
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

export const BodyLogProfileUpdateRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "nickname",
    "avatarKey"
  ],
  "properties": {
    "nickname": {
      "type": "string",
      "minLength": 2,
      "maxLength": 20
    },
    "avatarKey": {
      "type": "string",
      "enum": [
        "mint_runner",
        "blue_drop",
        "orange_sun",
        "purple_moon"
      ]
    }
  }
} as const;

export type BodyLogProfileUpdateRequest = {
  "nickname": string;
  "avatarKey": "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";
};

export const BodyLogTargetUserRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "targetUserId"
  ],
  "properties": {
    "targetUserId": {
      "type": "string",
      "minLength": 1
    }
  }
} as const;

export type BodyLogTargetUserRequest = {
  "targetUserId": string;
};

export const BodyLogReportRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "targetUserId",
    "reason"
  ],
  "properties": {
    "targetUserId": {
      "type": "string",
      "minLength": 1
    },
    "reason": {
      "type": "string",
      "enum": [
        "cheating",
        "offensive_profile",
        "harassment",
        "other"
      ]
    }
  }
} as const;

export type BodyLogReportRequest = {
  "targetUserId": string;
  "reason": "cheating" | "offensive_profile" | "harassment" | "other";
};

export const BodyLogLeaderboardJoinRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "seasonLabel",
    "timezone",
    "habits"
  ],
  "properties": {
    "seasonLabel": {
      "type": "string",
      "pattern": "^\\d{4}-W\\d{2}$"
    },
    "timezone": {
      "type": "string",
      "minLength": 1
    },
    "habits": {
      "type": "array",
      "minItems": 1,
      "maxItems": 5,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "habitId",
          "scheduledDates"
        ],
        "properties": {
          "habitId": {
            "type": "string",
            "minLength": 1
          },
          "scheduledDates": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          }
        }
      }
    }
  }
} as const;

export type BodyLogLeaderboardJoinRequest = {
  "seasonLabel": string;
  "timezone": string;
  "habits": (
{
  "habitId": string;
  "scheduledDates": string[];
}
)[];
};

export const BodyLogLeaderboardAggregateRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "seasonLabel",
    "date",
    "completedHabitIds"
  ],
  "properties": {
    "seasonLabel": {
      "type": "string",
      "pattern": "^\\d{4}-W\\d{2}$"
    },
    "date": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "completedHabitIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    }
  }
} as const;

export type BodyLogLeaderboardAggregateRequest = {
  "seasonLabel": string;
  "date": string;
  "completedHabitIds": string[];
};

export const BodyLogLeaderboardLeaveRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "timezone"
  ],
  "properties": {
    "timezone": {
      "type": "string",
      "minLength": 1
    }
  }
} as const;

export type BodyLogLeaderboardLeaveRequest = {
  "timezone": string;
};

export const BodyLogInvitationCreateRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "installId"
  ],
  "properties": {
    "installId": {
      "type": "string",
      "minLength": 8
    }
  }
} as const;

export type BodyLogInvitationCreateRequest = {
  "installId": string;
};

export const BodyLogInvitationAttributeRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "token",
    "installId"
  ],
  "properties": {
    "token": {
      "type": "string",
      "minLength": 1
    },
    "installId": {
      "type": "string",
      "minLength": 8
    }
  }
} as const;

export type BodyLogInvitationAttributeRequest = {
  "token": string;
  "installId": string;
};

export const BodyLogInvitationProgressRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "date",
    "timezone"
  ],
  "properties": {
    "date": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "timezone": {
      "type": "string",
      "minLength": 1
    }
  }
} as const;

export type BodyLogInvitationProgressRequest = {
  "date": string;
  "timezone": string;
};

export const BodyLogChallengeCreateRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "themeKey",
    "inviteeUserIds",
    "timezone"
  ],
  "properties": {
    "themeKey": {
      "type": "string",
      "enum": [
        "steady_week",
        "morning_rhythm",
        "movement_breaks",
        "mindful_week"
      ]
    },
    "inviteeUserIds": {
      "type": "array",
      "minItems": 1,
      "maxItems": 7,
      "uniqueItems": true,
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "timezone": {
      "type": "string",
      "minLength": 1
    }
  }
} as const;

export type BodyLogChallengeCreateRequest = {
  "themeKey": "steady_week" | "morning_rhythm" | "movement_breaks" | "mindful_week";
  "inviteeUserIds": string[];
  "timezone": string;
};

export const BodyLogChallengeResponseRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "action"
  ],
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "accept",
        "decline"
      ]
    }
  }
} as const;

export type BodyLogChallengeResponseRequest = {
  "action": "accept" | "decline";
};

export const BodyLogChallengeProgressRequestSchema = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "date",
    "completed",
    "timezone"
  ],
  "properties": {
    "date": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "completed": {
      "type": "boolean"
    },
    "timezone": {
      "type": "string",
      "minLength": 1
    }
  }
} as const;

export type BodyLogChallengeProgressRequest = {
  "date": string;
  "completed": boolean;
  "timezone": string;
};

export const BodyLogAvatarKeySchema = {
  "type": "string",
  "enum": [
    "mint_runner",
    "blue_drop",
    "orange_sun",
    "purple_moon"
  ]
} as const;

export type BodyLogAvatarKey = "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";

export const BodyLogReportReasonSchema = {
  "type": "string",
  "enum": [
    "cheating",
    "offensive_profile",
    "harassment",
    "other"
  ]
} as const;

export type BodyLogReportReason = "cheating" | "offensive_profile" | "harassment" | "other";

export const BodyLogChallengeThemeSchema = {
  "type": "string",
  "enum": [
    "steady_week",
    "morning_rhythm",
    "movement_breaks",
    "mindful_week"
  ]
} as const;

export type BodyLogChallengeTheme = "steady_week" | "morning_rhythm" | "movement_breaks" | "mindful_week";

export const BodyLogProfileDataSchema = {
  "type": "object",
  "required": [
    "userId",
    "nickname",
    "avatarKey",
    "profileCompleted",
    "createdAt",
    "updatedAt"
  ],
  "properties": {
    "userId": {
      "type": "string"
    },
    "nickname": {
      "type": "string"
    },
    "avatarKey": {
      "type": "string",
      "enum": [
        "mint_runner",
        "blue_drop",
        "orange_sun",
        "purple_moon"
      ]
    },
    "profileCompleted": {
      "type": "boolean"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type BodyLogProfileData = {
  "userId": string;
  "nickname": string;
  "avatarKey": "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";
  "profileCompleted": boolean;
  "createdAt": string;
  "updatedAt": string;
};

export const BodyLogFriendDataSchema = {
  "allOf": [
    {
      "type": "object",
      "required": [
        "userId",
        "nickname",
        "avatarKey",
        "profileCompleted",
        "createdAt",
        "updatedAt"
      ],
      "properties": {
        "userId": {
          "type": "string"
        },
        "nickname": {
          "type": "string"
        },
        "avatarKey": {
          "type": "string",
          "enum": [
            "mint_runner",
            "blue_drop",
            "orange_sun",
            "purple_moon"
          ]
        },
        "profileCompleted": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "friendsSince"
      ],
      "properties": {
        "friendsSince": {
          "type": "string",
          "format": "date-time"
        }
      }
    }
  ]
} as const;

export type BodyLogFriendData = (
{
  "userId": string;
  "nickname": string;
  "avatarKey": "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";
  "profileCompleted": boolean;
  "createdAt": string;
  "updatedAt": string;
}
) & (
{
  "friendsSince": string;
}
);

export const BodyLogFriendRequestRecordDataSchema = {
  "type": "object",
  "required": [
    "id",
    "appId",
    "senderUserId",
    "recipientUserId",
    "status",
    "createdAt",
    "updatedAt"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "appId": {
      "type": "string",
      "const": "bodylog"
    },
    "senderUserId": {
      "type": "string"
    },
    "recipientUserId": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "accepted",
        "rejected"
      ]
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type BodyLogFriendRequestRecordData = {
  "id": string;
  "appId": string;
  "senderUserId": string;
  "recipientUserId": string;
  "status": "pending" | "accepted" | "rejected";
  "createdAt": string;
  "updatedAt": string;
};

export const BodyLogFriendRequestListItemSchema = {
  "type": "object",
  "required": [
    "id",
    "direction",
    "profile",
    "createdAt"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "direction": {
      "type": "string",
      "enum": [
        "incoming",
        "outgoing"
      ]
    },
    "profile": {
      "type": "object",
      "required": [
        "userId",
        "nickname",
        "avatarKey",
        "profileCompleted",
        "createdAt",
        "updatedAt"
      ],
      "properties": {
        "userId": {
          "type": "string"
        },
        "nickname": {
          "type": "string"
        },
        "avatarKey": {
          "type": "string",
          "enum": [
            "mint_runner",
            "blue_drop",
            "orange_sun",
            "purple_moon"
          ]
        },
        "profileCompleted": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type BodyLogFriendRequestListItem = {
  "id": string;
  "direction": "incoming" | "outgoing";
  "profile": {
  "userId": string;
  "nickname": string;
  "avatarKey": "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";
  "profileCompleted": boolean;
  "createdAt": string;
  "updatedAt": string;
};
  "createdAt": string;
};

export const BodyLogFriendRequestStatusDataSchema = {
  "type": "object",
  "required": [
    "status"
  ],
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "accepted",
        "rejected"
      ]
    }
  }
} as const;

export type BodyLogFriendRequestStatusData = {
  "status": "accepted" | "rejected";
};

export const BodyLogBlockListItemSchema = {
  "type": "object",
  "required": [
    "profile",
    "createdAt"
  ],
  "properties": {
    "profile": {
      "type": "object",
      "required": [
        "userId",
        "nickname",
        "avatarKey",
        "profileCompleted",
        "createdAt",
        "updatedAt"
      ],
      "properties": {
        "userId": {
          "type": "string"
        },
        "nickname": {
          "type": "string"
        },
        "avatarKey": {
          "type": "string",
          "enum": [
            "mint_runner",
            "blue_drop",
            "orange_sun",
            "purple_moon"
          ]
        },
        "profileCompleted": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type BodyLogBlockListItem = {
  "profile": {
  "userId": string;
  "nickname": string;
  "avatarKey": "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";
  "profileCompleted": boolean;
  "createdAt": string;
  "updatedAt": string;
};
  "createdAt": string;
};

export const BodyLogLeaderboardMembershipSchema = {
  "type": "object",
  "required": [
    "joined",
    "eligible",
    "effectiveDays",
    "score"
  ],
  "properties": {
    "joined": {
      "type": "boolean"
    },
    "eligible": {
      "type": "boolean"
    },
    "effectiveDays": {
      "type": "integer",
      "minimum": 0
    },
    "score": {
      "type": "number",
      "minimum": 0
    }
  }
} as const;

export type BodyLogLeaderboardMembership = {
  "joined": boolean;
  "eligible": boolean;
  "effectiveDays": number;
  "score": number;
};

export const BodyLogLeaderboardJoinDataSchema = {
  "type": "object",
  "required": [
    "seasonLabel",
    "timezone",
    "membership"
  ],
  "properties": {
    "seasonLabel": {
      "type": "string"
    },
    "timezone": {
      "type": "string"
    },
    "membership": {
      "type": "object",
      "required": [
        "joined",
        "eligible",
        "effectiveDays",
        "score"
      ],
      "properties": {
        "joined": {
          "type": "boolean"
        },
        "eligible": {
          "type": "boolean"
        },
        "effectiveDays": {
          "type": "integer",
          "minimum": 0
        },
        "score": {
          "type": "number",
          "minimum": 0
        }
      }
    }
  }
} as const;

export type BodyLogLeaderboardJoinData = {
  "seasonLabel": string;
  "timezone": string;
  "membership": {
  "joined": boolean;
  "eligible": boolean;
  "effectiveDays": number;
  "score": number;
};
};

export const BodyLogLeaderboardEntrySchema = {
  "type": "object",
  "required": [
    "rank",
    "userId",
    "nickname",
    "avatarKey",
    "score",
    "effectiveDays",
    "completedInstances"
  ],
  "properties": {
    "rank": {
      "type": "integer",
      "minimum": 1
    },
    "userId": {
      "type": "string"
    },
    "nickname": {
      "type": "string"
    },
    "avatarKey": {
      "type": "string",
      "enum": [
        "mint_runner",
        "blue_drop",
        "orange_sun",
        "purple_moon"
      ]
    },
    "score": {
      "type": "number",
      "minimum": 0
    },
    "effectiveDays": {
      "type": "integer",
      "minimum": 0
    },
    "completedInstances": {
      "type": "integer",
      "minimum": 0
    }
  }
} as const;

export type BodyLogLeaderboardEntry = {
  "rank": number;
  "userId": string;
  "nickname": string;
  "avatarKey": "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";
  "score": number;
  "effectiveDays": number;
  "completedInstances": number;
};

export const BodyLogLeaderboardDataSchema = {
  "type": "object",
  "required": [
    "seasonLabel",
    "status",
    "scope",
    "entries",
    "membership",
    "updatedAt"
  ],
  "properties": {
    "seasonLabel": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "const": "live"
    },
    "scope": {
      "type": "string",
      "enum": [
        "public",
        "friends"
      ]
    },
    "entries": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "rank",
          "userId",
          "nickname",
          "avatarKey",
          "score",
          "effectiveDays",
          "completedInstances"
        ],
        "properties": {
          "rank": {
            "type": "integer",
            "minimum": 1
          },
          "userId": {
            "type": "string"
          },
          "nickname": {
            "type": "string"
          },
          "avatarKey": {
            "type": "string",
            "enum": [
              "mint_runner",
              "blue_drop",
              "orange_sun",
              "purple_moon"
            ]
          },
          "score": {
            "type": "number",
            "minimum": 0
          },
          "effectiveDays": {
            "type": "integer",
            "minimum": 0
          },
          "completedInstances": {
            "type": "integer",
            "minimum": 0
          }
        }
      }
    },
    "membership": {
      "type": "object",
      "required": [
        "joined",
        "eligible",
        "effectiveDays",
        "score"
      ],
      "properties": {
        "joined": {
          "type": "boolean"
        },
        "eligible": {
          "type": "boolean"
        },
        "effectiveDays": {
          "type": "integer",
          "minimum": 0
        },
        "score": {
          "type": "number",
          "minimum": 0
        }
      }
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type BodyLogLeaderboardData = {
  "seasonLabel": string;
  "status": string;
  "scope": "public" | "friends";
  "entries": (
{
  "rank": number;
  "userId": string;
  "nickname": string;
  "avatarKey": "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";
  "score": number;
  "effectiveDays": number;
  "completedInstances": number;
}
)[];
  "membership": {
  "joined": boolean;
  "eligible": boolean;
  "effectiveDays": number;
  "score": number;
};
  "updatedAt": string;
};

export const BodyLogInvitationCreateDataSchema = {
  "type": "object",
  "required": [
    "token",
    "url",
    "expiresAt"
  ],
  "properties": {
    "token": {
      "type": "string"
    },
    "url": {
      "type": "string",
      "format": "uri"
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type BodyLogInvitationCreateData = {
  "token": string;
  "url": string;
  "expiresAt": string;
};

export const BodyLogInvitationListItemSchema = {
  "type": "object",
  "required": [
    "id",
    "status",
    "progressDays",
    "attributedAt"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "qualified",
        "rewarded"
      ]
    },
    "progressDays": {
      "type": "integer",
      "minimum": 0
    },
    "attributedAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type BodyLogInvitationListItem = {
  "id": string;
  "status": "pending" | "qualified" | "rewarded";
  "progressDays": number;
  "attributedAt": string;
};

export const BodyLogInvitationStatusDataSchema = {
  "type": "object",
  "required": [
    "pendingCount",
    "qualifiedCount",
    "rewardedCount",
    "inviteeProgressDays",
    "attributed",
    "premiumUntil",
    "invitations"
  ],
  "properties": {
    "pendingCount": {
      "type": "integer",
      "minimum": 0
    },
    "qualifiedCount": {
      "type": "integer",
      "minimum": 0
    },
    "rewardedCount": {
      "type": "integer",
      "minimum": 0
    },
    "inviteeProgressDays": {
      "type": "integer",
      "minimum": 0
    },
    "attributed": {
      "type": "boolean"
    },
    "premiumUntil": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "invitations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "status",
          "progressDays",
          "attributedAt"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "qualified",
              "rewarded"
            ]
          },
          "progressDays": {
            "type": "integer",
            "minimum": 0
          },
          "attributedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    }
  }
} as const;

export type BodyLogInvitationStatusData = {
  "pendingCount": number;
  "qualifiedCount": number;
  "rewardedCount": number;
  "inviteeProgressDays": number;
  "attributed": boolean;
  "premiumUntil": string | null;
  "invitations": (
{
  "id": string;
  "status": "pending" | "qualified" | "rewarded";
  "progressDays": number;
  "attributedAt": string;
}
)[];
};

export const BodyLogInvitationAttributionDataSchema = {
  "type": "object",
  "required": [
    "attributed",
    "progressDays"
  ],
  "properties": {
    "attributed": {
      "type": "boolean",
      "const": true
    },
    "progressDays": {
      "type": "integer",
      "minimum": 0
    }
  }
} as const;

export type BodyLogInvitationAttributionData = {
  "attributed": boolean;
  "progressDays": number;
};

export const BodyLogInvitationProgressDataSchema = {
  "type": "object",
  "required": [
    "progressDays",
    "qualified"
  ],
  "properties": {
    "progressDays": {
      "type": "integer",
      "minimum": 0
    },
    "qualified": {
      "type": "boolean"
    },
    "premiumUntil": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    }
  }
} as const;

export type BodyLogInvitationProgressData = {
  "progressDays": number;
  "qualified": boolean;
  "premiumUntil"?: string | null;
};

export const BodyLogChallengeMemberDataSchema = {
  "type": "object",
  "required": [
    "userId",
    "nickname",
    "avatarKey",
    "memberStatus",
    "score",
    "effectiveDays",
    "rank"
  ],
  "properties": {
    "userId": {
      "type": "string"
    },
    "nickname": {
      "type": "string"
    },
    "avatarKey": {
      "type": "string",
      "enum": [
        "mint_runner",
        "blue_drop",
        "orange_sun",
        "purple_moon"
      ]
    },
    "memberStatus": {
      "type": "string",
      "enum": [
        "pending",
        "accepted",
        "declined"
      ]
    },
    "score": {
      "type": "number",
      "minimum": 0
    },
    "effectiveDays": {
      "type": "integer",
      "minimum": 0
    },
    "rank": {
      "type": "integer",
      "minimum": 1
    }
  }
} as const;

export type BodyLogChallengeMemberData = {
  "userId": string;
  "nickname": string;
  "avatarKey": "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";
  "memberStatus": "pending" | "accepted" | "declined";
  "score": number;
  "effectiveDays": number;
  "rank": number;
};

export const BodyLogChallengeDataSchema = {
  "type": "object",
  "required": [
    "id",
    "themeKey",
    "status",
    "timezone",
    "startDate",
    "endDate",
    "currentUserStatus",
    "members",
    "createdAt",
    "updatedAt"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "themeKey": {
      "type": "string",
      "enum": [
        "steady_week",
        "morning_rhythm",
        "movement_breaks",
        "mindful_week"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "active",
        "cancelled",
        "settled"
      ]
    },
    "timezone": {
      "type": "string"
    },
    "startDate": {
      "oneOf": [
        {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        {
          "type": "null"
        }
      ]
    },
    "endDate": {
      "oneOf": [
        {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        {
          "type": "null"
        }
      ]
    },
    "currentUserStatus": {
      "type": "string",
      "enum": [
        "pending",
        "accepted",
        "declined"
      ]
    },
    "members": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "userId",
          "nickname",
          "avatarKey",
          "memberStatus",
          "score",
          "effectiveDays",
          "rank"
        ],
        "properties": {
          "userId": {
            "type": "string"
          },
          "nickname": {
            "type": "string"
          },
          "avatarKey": {
            "type": "string",
            "enum": [
              "mint_runner",
              "blue_drop",
              "orange_sun",
              "purple_moon"
            ]
          },
          "memberStatus": {
            "type": "string",
            "enum": [
              "pending",
              "accepted",
              "declined"
            ]
          },
          "score": {
            "type": "number",
            "minimum": 0
          },
          "effectiveDays": {
            "type": "integer",
            "minimum": 0
          },
          "rank": {
            "type": "integer",
            "minimum": 1
          }
        }
      }
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type BodyLogChallengeData = {
  "id": string;
  "themeKey": "steady_week" | "morning_rhythm" | "movement_breaks" | "mindful_week";
  "status": "pending" | "active" | "cancelled" | "settled";
  "timezone": string;
  "startDate": string | unknown;
  "endDate": string | unknown;
  "currentUserStatus": "pending" | "accepted" | "declined";
  "members": (
{
  "userId": string;
  "nickname": string;
  "avatarKey": "mint_runner" | "blue_drop" | "orange_sun" | "purple_moon";
  "memberStatus": "pending" | "accepted" | "declined";
  "score": number;
  "effectiveDays": number;
  "rank": number;
}
)[];
  "createdAt": string;
  "updatedAt": string;
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
      "oneOf": [
        {
          "type": "string",
          "minLength": 1
        },
        {
          "type": "object",
          "additionalProperties": false,
          "minProperties": 1,
          "maxProperties": 1,
          "properties": {
            "email": {
              "type": "string",
              "format": "email"
            },
            "user_id": {
              "type": "string",
              "minLength": 1
            }
          }
        }
      ]
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
  "target": string | {
  "email"?: string;
  "user_id"?: string;
};
  "domains": (
"sleep" | "focus"
)[];
};

export const BuddyInvitationTargetSchema = {
  "type": "object",
  "additionalProperties": false,
  "minProperties": 1,
  "maxProperties": 1,
  "properties": {
    "email": {
      "type": "string",
      "format": "email"
    },
    "user_id": {
      "type": "string",
      "minLength": 1
    }
  }
} as const;

export type BuddyInvitationTarget = {
  "email"?: string;
  "user_id"?: string;
};

export const BuddyInvitationDeliveryStatusSchema = {
  "type": "string",
  "enum": [
    "queued",
    "processing",
    "provider_accepted",
    "delivered",
    "bounced",
    "suppressed",
    "retryable_failed",
    "dead_letter"
  ]
} as const;

export type BuddyInvitationDeliveryStatus = "queued" | "processing" | "provider_accepted" | "delivered" | "bounced" | "suppressed" | "retryable_failed" | "dead_letter";

export const BuddyInvitationDomainResultSchema = {
  "type": "object",
  "required": [
    "domain",
    "status"
  ],
  "properties": {
    "domain": {
      "type": "string",
      "enum": [
        "sleep",
        "focus"
      ]
    },
    "relationship_id": {
      "type": [
        "string",
        "null"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "accepted",
        "declined",
        "cancelled",
        "expired"
      ]
    },
    "error_code": {
      "type": [
        "string",
        "null"
      ]
    }
  }
} as const;

export type BuddyInvitationDomainResult = {
  "domain": "sleep" | "focus";
  "relationship_id"?: string | null;
  "status": "pending" | "accepted" | "declined" | "cancelled" | "expired";
  "error_code"?: string | null;
};

export const BuddyInvitationDeliverySchema = {
  "type": "object",
  "required": [
    "channel",
    "status",
    "attempt_count"
  ],
  "properties": {
    "channel": {
      "type": "string",
      "enum": [
        "email"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "queued",
        "processing",
        "provider_accepted",
        "delivered",
        "bounced",
        "suppressed",
        "retryable_failed",
        "dead_letter"
      ]
    },
    "attempt_count": {
      "type": "integer",
      "minimum": 0
    },
    "provider_accepted_at": {
      "type": "string",
      "format": "date-time"
    },
    "delivered_at": {
      "type": "string",
      "format": "date-time"
    },
    "last_error_code": {
      "type": "string"
    }
  }
} as const;

export type BuddyInvitationDelivery = {
  "channel": "email";
  "status": "queued" | "processing" | "provider_accepted" | "delivered" | "bounced" | "suppressed" | "retryable_failed" | "dead_letter";
  "attempt_count": number;
  "provider_accepted_at"?: string;
  "delivered_at"?: string;
  "last_error_code"?: string;
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
  "sharing_categories"?: (
"presence" | "daily_summary" | "weekly_trend" | "shared_activity"
)[];
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

export const BuddyGroupCreateRequestSchema = {
  "type": "object",
  "required": [
    "domain",
    "group_name"
  ],
  "additionalProperties": true,
  "properties": {
    "domain": {
      "type": "string",
      "enum": [
        "sleep",
        "focus"
      ]
    },
    "group_name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 40
    },
    "group_description": {
      "type": "string",
      "maxLength": 160
    },
    "sharing_baseline": {
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
    },
    "invitees": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "user_id": {
            "type": "string",
            "minLength": 1
          },
          "email": {
            "type": "string",
            "format": "email"
          }
        },
        "anyOf": [
          {
            "required": [
              "user_id"
            ]
          },
          {
            "required": [
              "email"
            ]
          }
        ]
      }
    }
  }
} as const;

export type BuddyGroupCreateRequest = {
  "domain": "sleep" | "focus";
  "group_name": string;
  "group_description"?: string;
  "sharing_baseline"?: (
"presence" | "daily_summary" | "weekly_trend" | "shared_activity"
)[];
  "invitees"?: (
(
{
  "user_id": string;
  "email"?: string;
}
) | (
{
  "user_id"?: string;
  "email": string;
}
)
)[];
  [key: string]: unknown;
};

export const BuddyGroupUpdateRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "group_name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 40
    },
    "group_description": {
      "type": "string",
      "maxLength": 160
    },
    "sharing_baseline": {
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

export type BuddyGroupUpdateRequest = {
  "group_name"?: string;
  "group_description"?: string;
  "sharing_baseline"?: (
"presence" | "daily_summary" | "weekly_trend" | "shared_activity"
)[];
  [key: string]: unknown;
};

export const BuddyGroupInviteRequestSchema = {
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "user_id": {
      "type": "string",
      "minLength": 1
    },
    "email": {
      "type": "string",
      "format": "email"
    },
    "invitees": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "user_id": {
            "type": "string",
            "minLength": 1
          },
          "email": {
            "type": "string",
            "format": "email"
          }
        },
        "anyOf": [
          {
            "required": [
              "user_id"
            ]
          },
          {
            "required": [
              "email"
            ]
          }
        ]
      }
    }
  },
  "anyOf": [
    {
      "required": [
        "user_id"
      ]
    },
    {
      "required": [
        "email"
      ]
    },
    {
      "required": [
        "invitees"
      ]
    }
  ]
} as const;

export type BuddyGroupInviteRequest = (
{
  "user_id": string;
  "email"?: string;
  "invitees"?: (
(
{
  "user_id": string;
  "email"?: string;
}
) | (
{
  "user_id"?: string;
  "email": string;
}
)
)[];
  [key: string]: unknown;
}
) | (
{
  "user_id"?: string;
  "email": string;
  "invitees"?: (
(
{
  "user_id": string;
  "email"?: string;
}
) | (
{
  "user_id"?: string;
  "email": string;
}
)
)[];
  [key: string]: unknown;
}
) | (
{
  "user_id"?: string;
  "email"?: string;
  "invitees": (
(
{
  "user_id": string;
  "email"?: string;
}
) | (
{
  "user_id"?: string;
  "email": string;
}
)
)[];
  [key: string]: unknown;
}
);

export const BuddyGroupRoleUpdateRequestSchema = {
  "type": "object",
  "required": [
    "role"
  ],
  "additionalProperties": true,
  "properties": {
    "role": {
      "type": "string",
      "enum": [
        "moderator",
        "member"
      ]
    }
  }
} as const;

export type BuddyGroupRoleUpdateRequest = {
  "role": "moderator" | "member";
  [key: string]: unknown;
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
  "disabled_categories"?: (
"invitations" | "interactions" | "activities" | "goals" | "reports"
)[];
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
        "tonight_together",
        "group_cheer",
        "group_goodnight"
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
  "type": "encouragement" | "praise" | "support" | "join_next_time" | "tonight_together" | "group_cheer" | "group_goodnight";
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
  "BodyLogAvatarKey",
  "BodyLogBlockListItem",
  "BodyLogChallengeCreateRequest",
  "BodyLogChallengeData",
  "BodyLogChallengeMemberData",
  "BodyLogChallengeProgressRequest",
  "BodyLogChallengeResponseRequest",
  "BodyLogChallengeTheme",
  "BodyLogFriendData",
  "BodyLogFriendRequestListItem",
  "BodyLogFriendRequestRecordData",
  "BodyLogFriendRequestStatusData",
  "BodyLogInvitationAttributeRequest",
  "BodyLogInvitationAttributionData",
  "BodyLogInvitationCreateData",
  "BodyLogInvitationCreateRequest",
  "BodyLogInvitationListItem",
  "BodyLogInvitationProgressData",
  "BodyLogInvitationProgressRequest",
  "BodyLogInvitationStatusData",
  "BodyLogLeaderboardAggregateRequest",
  "BodyLogLeaderboardData",
  "BodyLogLeaderboardEntry",
  "BodyLogLeaderboardJoinData",
  "BodyLogLeaderboardJoinRequest",
  "BodyLogLeaderboardLeaveRequest",
  "BodyLogLeaderboardMembership",
  "BodyLogProfileData",
  "BodyLogProfileUpdateRequest",
  "BodyLogReportReason",
  "BodyLogReportRequest",
  "BodyLogTargetUserRequest",
  "BuddyGroupCreateRequest",
  "BuddyGroupInviteRequest",
  "BuddyGroupRoleUpdateRequest",
  "BuddyGroupUpdateRequest",
  "BuddyInteractionRequest",
  "BuddyInvitationCreateRequest",
  "BuddyInvitationDelivery",
  "BuddyInvitationDeliveryStatus",
  "BuddyInvitationDomainResult",
  "BuddyInvitationResponseRequest",
  "BuddyInvitationTarget",
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
  "PasswordSmsCodeRequest",
  "PublicConfigData",
  "QrLoginConfirmData",
  "QrLoginCreateData",
  "QrLoginCreateRequest",
  "QrLoginPollData",
  "RefreshRequest",
  "RegisterBySmsRequest",
  "RegisterRequest",
  "ResetPasswordBySmsRequest",
  "ResetPasswordRequest",
  "SetPasswordRequest",
  "SmsCodeRequest",
  "SmsLoginRequest",
  "UserSummary"
] as const;
