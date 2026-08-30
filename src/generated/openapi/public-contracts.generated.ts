// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated from api-contracts/openapi for Zook public API boundaries.

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

export const LightTickIdSchema = {
  "type": "string",
  "minLength": 8,
  "maxLength": 128,
  "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
} as const;

export type LightTickId = string;

export const LightTickVersionSchema = {
  "type": "integer",
  "minimum": 1
} as const;

export type LightTickVersion = number;

export const LightTickTimestampSchema = {
  "type": "string",
  "format": "date-time"
} as const;

export type LightTickTimestamp = string;

export const LightTickTimezoneSchema = {
  "type": "string",
  "minLength": 1,
  "maxLength": 64,
  "description": "IANA timezone identifier such as Asia/Shanghai."
} as const;

export type LightTickTimezone = string;

export const LightTickEnvelopeSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data",
    "requestId"
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
      "additionalProperties": true
    },
    "requestId": {
      "type": "string"
    }
  }
} as const;

export type LightTickEnvelope = {
  "code": string;
  "message": string;
  "data": {
  [key: string]: unknown;
};
  "requestId": string;
};

export const LightTickRunEnvelopeSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data",
    "requestId"
  ],
  "properties": {
    "code": {
      "type": "string",
      "example": "ACCEPTED"
    },
    "message": {
      "type": "string",
      "example": "accepted"
    },
    "data": {
      "type": "object",
      "required": [
        "id",
        "kind",
        "scene",
        "status",
        "retryable",
        "created_at",
        "updated_at"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "kind": {
          "type": "string",
          "enum": [
            "onboarding_plan",
            "plan",
            "review",
            "change_proposal",
            "coach_reply"
          ]
        },
        "scene": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "queued",
            "running",
            "succeeded",
            "failed",
            "cancelled"
          ]
        },
        "retryable": {
          "type": "boolean"
        },
        "result_resource_type": {
          "enum": [
            "goal",
            "plan",
            "review",
            "change_proposal",
            "coach_message"
          ]
        },
        "result_resource_id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "source": {
          "enum": [
            "ai",
            "template",
            "manual"
          ]
        },
        "error_code": {
          "type": "string",
          "enum": [
            "REQ_INVALID_BODY",
            "REQ_FIELD_REQUIRED",
            "REQ_FIELD_INVALID",
            "AUTH_REQUIRED",
            "AUTH_TOKEN_INVALID",
            "AUTH_SESSION_REVOKED",
            "APP_SCOPE_FORBIDDEN",
            "APP_MEMBER_INACTIVE",
            "LIGHTTICK_APP_DISABLED",
            "LIGHTTICK_GUEST_SESSION_EXPIRED",
            "LIGHTTICK_GUEST_UPGRADE_INVALID",
            "LIGHTTICK_GUEST_CREDENTIAL_INVALID",
            "LIGHTTICK_GUEST_EXPIRED",
            "LIGHTTICK_GUEST_REVOKED",
            "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
            "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED",
            "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED",
            "LIGHTTICK_REAUTH_REQUIRED",
            "LIGHTTICK_APP_ACCESS_DENIED",
            "LIGHTTICK_RESOURCE_NOT_FOUND",
            "LIGHTTICK_STATE_TRANSITION_INVALID",
            "LIGHTTICK_VERSION_CONFLICT",
            "LIGHTTICK_IDEMPOTENCY_MISMATCH",
            "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
            "LIGHTTICK_AI_RUN_FAILED",
            "LIGHTTICK_AI_UNAVAILABLE",
            "LIGHTTICK_AI_QUOTA_EXCEEDED",
            "LIGHTTICK_RUN_NOT_READY",
            "LIGHTTICK_PROPOSAL_STALE",
            "LIGHTTICK_PROPOSAL_NOT_PENDING",
            "LIGHTTICK_SYNC_CURSOR_INVALID",
            "LIGHTTICK_SYNC_BATCH_TOO_LARGE",
            "LIGHTTICK_SYNC_OPERATION_REJECTED",
            "LIGHTTICK_TIMEZONE_INVALID",
            "RATE_LIMITED",
            "INTERNAL_ERROR"
          ]
        },
        "result": {
          "type": "object",
          "additionalProperties": true
        },
        "created_at": {
          "type": "string",
          "format": "date-time"
        },
        "updated_at": {
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

export type LightTickRunEnvelope = {
  "code": string;
  "message": string;
  "data": {
  "id": string;
  "kind": "onboarding_plan" | "plan" | "review" | "change_proposal" | "coach_reply";
  "scene": string;
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "retryable": boolean;
  "result_resource_type"?: "goal" | "plan" | "review" | "change_proposal" | "coach_message";
  "result_resource_id"?: string;
  "source"?: "ai" | "template" | "manual";
  "error_code"?: "REQ_INVALID_BODY" | "REQ_FIELD_REQUIRED" | "REQ_FIELD_INVALID" | "AUTH_REQUIRED" | "AUTH_TOKEN_INVALID" | "AUTH_SESSION_REVOKED" | "APP_SCOPE_FORBIDDEN" | "APP_MEMBER_INACTIVE" | "LIGHTTICK_APP_DISABLED" | "LIGHTTICK_GUEST_SESSION_EXPIRED" | "LIGHTTICK_GUEST_UPGRADE_INVALID" | "LIGHTTICK_GUEST_CREDENTIAL_INVALID" | "LIGHTTICK_GUEST_EXPIRED" | "LIGHTTICK_GUEST_REVOKED" | "LIGHTTICK_GUEST_UPGRADE_CONFLICT" | "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED" | "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED" | "LIGHTTICK_REAUTH_REQUIRED" | "LIGHTTICK_APP_ACCESS_DENIED" | "LIGHTTICK_RESOURCE_NOT_FOUND" | "LIGHTTICK_STATE_TRANSITION_INVALID" | "LIGHTTICK_VERSION_CONFLICT" | "LIGHTTICK_IDEMPOTENCY_MISMATCH" | "LIGHTTICK_PLAN_CONSTRAINT_FAILED" | "LIGHTTICK_AI_RUN_FAILED" | "LIGHTTICK_AI_UNAVAILABLE" | "LIGHTTICK_AI_QUOTA_EXCEEDED" | "LIGHTTICK_RUN_NOT_READY" | "LIGHTTICK_PROPOSAL_STALE" | "LIGHTTICK_PROPOSAL_NOT_PENDING" | "LIGHTTICK_SYNC_CURSOR_INVALID" | "LIGHTTICK_SYNC_BATCH_TOO_LARGE" | "LIGHTTICK_SYNC_OPERATION_REJECTED" | "LIGHTTICK_TIMEZONE_INVALID" | "RATE_LIMITED" | "INTERNAL_ERROR";
  "result"?: {
  [key: string]: unknown;
};
  "created_at": string;
  "updated_at": string;
};
  "requestId": string;
};

export const LightTickErrorEnvelopeSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data",
    "requestId"
  ],
  "properties": {
    "code": {
      "type": "string",
      "enum": [
        "REQ_INVALID_BODY",
        "REQ_FIELD_REQUIRED",
        "REQ_FIELD_INVALID",
        "AUTH_REQUIRED",
        "AUTH_TOKEN_INVALID",
        "AUTH_SESSION_REVOKED",
        "APP_SCOPE_FORBIDDEN",
        "APP_MEMBER_INACTIVE",
        "LIGHTTICK_APP_DISABLED",
        "LIGHTTICK_GUEST_SESSION_EXPIRED",
        "LIGHTTICK_GUEST_UPGRADE_INVALID",
        "LIGHTTICK_GUEST_CREDENTIAL_INVALID",
        "LIGHTTICK_GUEST_EXPIRED",
        "LIGHTTICK_GUEST_REVOKED",
        "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
        "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED",
        "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED",
        "LIGHTTICK_REAUTH_REQUIRED",
        "LIGHTTICK_APP_ACCESS_DENIED",
        "LIGHTTICK_RESOURCE_NOT_FOUND",
        "LIGHTTICK_STATE_TRANSITION_INVALID",
        "LIGHTTICK_VERSION_CONFLICT",
        "LIGHTTICK_IDEMPOTENCY_MISMATCH",
        "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
        "LIGHTTICK_AI_RUN_FAILED",
        "LIGHTTICK_AI_UNAVAILABLE",
        "LIGHTTICK_AI_QUOTA_EXCEEDED",
        "LIGHTTICK_RUN_NOT_READY",
        "LIGHTTICK_PROPOSAL_STALE",
        "LIGHTTICK_PROPOSAL_NOT_PENDING",
        "LIGHTTICK_SYNC_CURSOR_INVALID",
        "LIGHTTICK_SYNC_BATCH_TOO_LARGE",
        "LIGHTTICK_SYNC_OPERATION_REJECTED",
        "LIGHTTICK_TIMEZONE_INVALID",
        "RATE_LIMITED",
        "INTERNAL_ERROR"
      ]
    },
    "message": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "required": [
        "retryable"
      ],
      "properties": {
        "retryable": {
          "type": "boolean"
        },
        "field": {
          "type": "string"
        },
        "resource_id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "current_version": {
          "type": "integer",
          "minimum": 1
        },
        "server_snapshot": {
          "type": "object",
          "additionalProperties": true
        },
        "conflict_fields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "resolution_actions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "retry_after_seconds": {
          "type": "integer",
          "minimum": 0
        },
        "violations": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "code",
              "message"
            ],
            "properties": {
              "code": {
                "type": "string"
              },
              "message": {
                "type": "string"
              },
              "field": {
                "type": "string"
              }
            }
          }
        }
      }
    },
    "requestId": {
      "type": "string"
    }
  }
} as const;

export type LightTickErrorEnvelope = {
  "code": "REQ_INVALID_BODY" | "REQ_FIELD_REQUIRED" | "REQ_FIELD_INVALID" | "AUTH_REQUIRED" | "AUTH_TOKEN_INVALID" | "AUTH_SESSION_REVOKED" | "APP_SCOPE_FORBIDDEN" | "APP_MEMBER_INACTIVE" | "LIGHTTICK_APP_DISABLED" | "LIGHTTICK_GUEST_SESSION_EXPIRED" | "LIGHTTICK_GUEST_UPGRADE_INVALID" | "LIGHTTICK_GUEST_CREDENTIAL_INVALID" | "LIGHTTICK_GUEST_EXPIRED" | "LIGHTTICK_GUEST_REVOKED" | "LIGHTTICK_GUEST_UPGRADE_CONFLICT" | "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED" | "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED" | "LIGHTTICK_REAUTH_REQUIRED" | "LIGHTTICK_APP_ACCESS_DENIED" | "LIGHTTICK_RESOURCE_NOT_FOUND" | "LIGHTTICK_STATE_TRANSITION_INVALID" | "LIGHTTICK_VERSION_CONFLICT" | "LIGHTTICK_IDEMPOTENCY_MISMATCH" | "LIGHTTICK_PLAN_CONSTRAINT_FAILED" | "LIGHTTICK_AI_RUN_FAILED" | "LIGHTTICK_AI_UNAVAILABLE" | "LIGHTTICK_AI_QUOTA_EXCEEDED" | "LIGHTTICK_RUN_NOT_READY" | "LIGHTTICK_PROPOSAL_STALE" | "LIGHTTICK_PROPOSAL_NOT_PENDING" | "LIGHTTICK_SYNC_CURSOR_INVALID" | "LIGHTTICK_SYNC_BATCH_TOO_LARGE" | "LIGHTTICK_SYNC_OPERATION_REJECTED" | "LIGHTTICK_TIMEZONE_INVALID" | "RATE_LIMITED" | "INTERNAL_ERROR";
  "message": string;
  "data": {
  "retryable": boolean;
  "field"?: string;
  "resource_id"?: string;
  "current_version"?: number;
  "server_snapshot"?: {
  [key: string]: unknown;
};
  "conflict_fields"?: string[];
  "resolution_actions"?: string[];
  "retry_after_seconds"?: number;
  "violations"?: (
{
  "code": string;
  "message": string;
  "field"?: string;
}
)[];
};
  "requestId": string;
};

export const LightTickErrorCodeSchema = {
  "type": "string",
  "enum": [
    "REQ_INVALID_BODY",
    "REQ_FIELD_REQUIRED",
    "REQ_FIELD_INVALID",
    "AUTH_REQUIRED",
    "AUTH_TOKEN_INVALID",
    "AUTH_SESSION_REVOKED",
    "APP_SCOPE_FORBIDDEN",
    "APP_MEMBER_INACTIVE",
    "LIGHTTICK_APP_DISABLED",
    "LIGHTTICK_GUEST_SESSION_EXPIRED",
    "LIGHTTICK_GUEST_UPGRADE_INVALID",
    "LIGHTTICK_GUEST_CREDENTIAL_INVALID",
    "LIGHTTICK_GUEST_EXPIRED",
    "LIGHTTICK_GUEST_REVOKED",
    "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
    "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED",
    "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED",
    "LIGHTTICK_REAUTH_REQUIRED",
    "LIGHTTICK_APP_ACCESS_DENIED",
    "LIGHTTICK_RESOURCE_NOT_FOUND",
    "LIGHTTICK_STATE_TRANSITION_INVALID",
    "LIGHTTICK_VERSION_CONFLICT",
    "LIGHTTICK_IDEMPOTENCY_MISMATCH",
    "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
    "LIGHTTICK_AI_RUN_FAILED",
    "LIGHTTICK_AI_UNAVAILABLE",
    "LIGHTTICK_AI_QUOTA_EXCEEDED",
    "LIGHTTICK_RUN_NOT_READY",
    "LIGHTTICK_PROPOSAL_STALE",
    "LIGHTTICK_PROPOSAL_NOT_PENDING",
    "LIGHTTICK_SYNC_CURSOR_INVALID",
    "LIGHTTICK_SYNC_BATCH_TOO_LARGE",
    "LIGHTTICK_SYNC_OPERATION_REJECTED",
    "LIGHTTICK_TIMEZONE_INVALID",
    "RATE_LIMITED",
    "INTERNAL_ERROR"
  ]
} as const;

export type LightTickErrorCode = "REQ_INVALID_BODY" | "REQ_FIELD_REQUIRED" | "REQ_FIELD_INVALID" | "AUTH_REQUIRED" | "AUTH_TOKEN_INVALID" | "AUTH_SESSION_REVOKED" | "APP_SCOPE_FORBIDDEN" | "APP_MEMBER_INACTIVE" | "LIGHTTICK_APP_DISABLED" | "LIGHTTICK_GUEST_SESSION_EXPIRED" | "LIGHTTICK_GUEST_UPGRADE_INVALID" | "LIGHTTICK_GUEST_CREDENTIAL_INVALID" | "LIGHTTICK_GUEST_EXPIRED" | "LIGHTTICK_GUEST_REVOKED" | "LIGHTTICK_GUEST_UPGRADE_CONFLICT" | "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED" | "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED" | "LIGHTTICK_REAUTH_REQUIRED" | "LIGHTTICK_APP_ACCESS_DENIED" | "LIGHTTICK_RESOURCE_NOT_FOUND" | "LIGHTTICK_STATE_TRANSITION_INVALID" | "LIGHTTICK_VERSION_CONFLICT" | "LIGHTTICK_IDEMPOTENCY_MISMATCH" | "LIGHTTICK_PLAN_CONSTRAINT_FAILED" | "LIGHTTICK_AI_RUN_FAILED" | "LIGHTTICK_AI_UNAVAILABLE" | "LIGHTTICK_AI_QUOTA_EXCEEDED" | "LIGHTTICK_RUN_NOT_READY" | "LIGHTTICK_PROPOSAL_STALE" | "LIGHTTICK_PROPOSAL_NOT_PENDING" | "LIGHTTICK_SYNC_CURSOR_INVALID" | "LIGHTTICK_SYNC_BATCH_TOO_LARGE" | "LIGHTTICK_SYNC_OPERATION_REJECTED" | "LIGHTTICK_TIMEZONE_INVALID" | "RATE_LIMITED" | "INTERNAL_ERROR";

export const LightTickErrorDataSchema = {
  "type": "object",
  "required": [
    "retryable"
  ],
  "properties": {
    "retryable": {
      "type": "boolean"
    },
    "field": {
      "type": "string"
    },
    "resource_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "current_version": {
      "type": "integer",
      "minimum": 1
    },
    "server_snapshot": {
      "type": "object",
      "additionalProperties": true
    },
    "conflict_fields": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "resolution_actions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "retry_after_seconds": {
      "type": "integer",
      "minimum": 0
    },
    "violations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "code",
          "message"
        ],
        "properties": {
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "field": {
            "type": "string"
          }
        }
      }
    }
  }
} as const;

export type LightTickErrorData = {
  "retryable": boolean;
  "field"?: string;
  "resource_id"?: string;
  "current_version"?: number;
  "server_snapshot"?: {
  [key: string]: unknown;
};
  "conflict_fields"?: string[];
  "resolution_actions"?: string[];
  "retry_after_seconds"?: number;
  "violations"?: (
{
  "code": string;
  "message": string;
  "field"?: string;
}
)[];
};

export const LightTickConstraintViolationSchema = {
  "type": "object",
  "required": [
    "code",
    "message"
  ],
  "properties": {
    "code": {
      "type": "string"
    },
    "message": {
      "type": "string"
    },
    "field": {
      "type": "string"
    }
  }
} as const;

export type LightTickConstraintViolation = {
  "code": string;
  "message": string;
  "field"?: string;
};

export const LightTickProfileDataSchema = {
  "type": "object",
  "required": [
    "user_id",
    "timezone",
    "locale",
    "pace",
    "onboarding_state",
    "version",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "user_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "timezone": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "IANA timezone identifier such as Asia/Shanghai."
    },
    "locale": {
      "type": "string",
      "minLength": 2,
      "maxLength": 16
    },
    "pace": {
      "type": "string",
      "enum": [
        "compact",
        "balanced",
        "relaxed"
      ]
    },
    "onboarding_state": {
      "enum": [
        "not_started",
        "drafting",
        "generating",
        "proposed",
        "completed",
        "failed"
      ]
    },
    "notification_preferences": {
      "type": "object",
      "properties": {
        "enabled": {
          "type": "boolean",
          "default": true
        },
        "daily_reminder_time": {
          "type": "string",
          "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
        },
        "review_reminders": {
          "type": "boolean",
          "default": true
        },
        "quiet_hours_start": {
          "type": "string",
          "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
        },
        "quiet_hours_end": {
          "type": "string",
          "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
        }
      },
      "additionalProperties": false
    },
    "version": {
      "type": "integer",
      "minimum": 1
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickProfileData = {
  "user_id": string;
  "timezone": string;
  "locale": string;
  "pace": "compact" | "balanced" | "relaxed";
  "onboarding_state": "not_started" | "drafting" | "generating" | "proposed" | "completed" | "failed";
  "notification_preferences"?: {
  "enabled"?: boolean;
  "daily_reminder_time"?: string;
  "review_reminders"?: boolean;
  "quiet_hours_start"?: string;
  "quiet_hours_end"?: string;
};
  "version": number;
  "created_at": string;
  "updated_at": string;
};

export const LightTickProfileUpdateRequestSchema = {
  "type": "object",
  "required": [
    "base_version"
  ],
  "properties": {
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "timezone": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "IANA timezone identifier such as Asia/Shanghai."
    },
    "locale": {
      "type": "string",
      "minLength": 2,
      "maxLength": 16
    },
    "pace": {
      "type": "string",
      "enum": [
        "compact",
        "balanced",
        "relaxed"
      ]
    },
    "notification_preferences": {
      "type": "object",
      "properties": {
        "enabled": {
          "type": "boolean",
          "default": true
        },
        "daily_reminder_time": {
          "type": "string",
          "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
        },
        "review_reminders": {
          "type": "boolean",
          "default": true
        },
        "quiet_hours_start": {
          "type": "string",
          "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
        },
        "quiet_hours_end": {
          "type": "string",
          "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
} as const;

export type LightTickProfileUpdateRequest = {
  "base_version": number;
  "timezone"?: string;
  "locale"?: string;
  "pace"?: "compact" | "balanced" | "relaxed";
  "notification_preferences"?: {
  "enabled"?: boolean;
  "daily_reminder_time"?: string;
  "review_reminders"?: boolean;
  "quiet_hours_start"?: string;
  "quiet_hours_end"?: string;
};
};

export const LightTickPaceSchema = {
  "type": "string",
  "enum": [
    "compact",
    "balanced",
    "relaxed"
  ]
} as const;

export type LightTickPace = "compact" | "balanced" | "relaxed";

export const LightTickNotificationPreferencesSchema = {
  "type": "object",
  "properties": {
    "enabled": {
      "type": "boolean",
      "default": true
    },
    "daily_reminder_time": {
      "type": "string",
      "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
    },
    "review_reminders": {
      "type": "boolean",
      "default": true
    },
    "quiet_hours_start": {
      "type": "string",
      "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
    },
    "quiet_hours_end": {
      "type": "string",
      "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
    }
  },
  "additionalProperties": false
} as const;

export type LightTickNotificationPreferences = {
  "enabled"?: boolean;
  "daily_reminder_time"?: string;
  "review_reminders"?: boolean;
  "quiet_hours_start"?: string;
  "quiet_hours_end"?: string;
};

export const LightTickOnboardingRequestSchema = {
  "type": "object",
  "required": [
    "title",
    "current_level",
    "weekly_available_minutes",
    "pace",
    "timezone"
  ],
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "maxLength": 4000
    },
    "current_level": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "weekly_available_minutes": {
      "type": "integer",
      "minimum": 30,
      "maximum": 10080
    },
    "pace": {
      "type": "string",
      "enum": [
        "compact",
        "balanced",
        "relaxed"
      ]
    },
    "timezone": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "IANA timezone identifier such as Asia/Shanghai."
    },
    "target_date": {
      "type": "string",
      "format": "date"
    },
    "duration_months": {
      "type": "integer",
      "minimum": 1,
      "maximum": 120
    },
    "motivation": {
      "type": "string",
      "maxLength": 4000
    },
    "availability_windows": {
      "type": "array",
      "maxItems": 28,
      "items": {
        "type": "object",
        "required": [
          "weekday",
          "start_time",
          "end_time"
        ],
        "properties": {
          "weekday": {
            "type": "integer",
            "minimum": 1,
            "maximum": 7
          },
          "start_time": {
            "type": "string",
            "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
          },
          "end_time": {
            "type": "string",
            "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
} as const;

export type LightTickOnboardingRequest = {
  "title": string;
  "description"?: string;
  "current_level": string;
  "weekly_available_minutes": number;
  "pace": "compact" | "balanced" | "relaxed";
  "timezone": string;
  "target_date"?: string;
  "duration_months"?: number;
  "motivation"?: string;
  "availability_windows"?: (
{
  "weekday": number;
  "start_time": string;
  "end_time": string;
}
)[];
};

export const LightTickStarterRequestSchema = {
  "type": "object",
  "required": [
    "wish",
    "timezone"
  ],
  "properties": {
    "wish": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "timezone": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "IANA timezone identifier such as Asia/Shanghai."
    },
    "locale": {
      "type": "string",
      "minLength": 2,
      "maxLength": 16
    }
  },
  "additionalProperties": false
} as const;

export type LightTickStarterRequest = {
  "wish": string;
  "timezone": string;
  "locale"?: string;
};

export const LightTickTaskVariantSchema = {
  "type": "string",
  "enum": [
    "standard",
    "light",
    "minimum"
  ]
} as const;

export type LightTickTaskVariant = "standard" | "light" | "minimum";

export const LightTickTaskVariantDefinitionSchema = {
  "type": "object",
  "required": [
    "title",
    "estimated_duration_minutes",
    "completion_criteria"
  ],
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "estimated_duration_minutes": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1440
    },
    "completion_criteria": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    }
  },
  "additionalProperties": false
} as const;

export type LightTickTaskVariantDefinition = {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};

export const LightTickStarterCandidateSchema = {
  "type": "object",
  "required": [
    "candidate_id",
    "title",
    "assumption",
    "variants"
  ],
  "properties": {
    "candidate_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "title": {
      "type": "string"
    },
    "assumption": {
      "type": "string"
    },
    "variants": {
      "type": "object",
      "required": [
        "standard",
        "light",
        "minimum"
      ],
      "properties": {
        "standard": {
          "type": "object",
          "required": [
            "title",
            "estimated_duration_minutes",
            "completion_criteria"
          ],
          "properties": {
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "estimated_duration_minutes": {
              "type": "integer",
              "minimum": 1,
              "maximum": 1440
            },
            "completion_criteria": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000
            }
          },
          "additionalProperties": false
        },
        "light": {
          "type": "object",
          "required": [
            "title",
            "estimated_duration_minutes",
            "completion_criteria"
          ],
          "properties": {
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "estimated_duration_minutes": {
              "type": "integer",
              "minimum": 1,
              "maximum": 1440
            },
            "completion_criteria": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000
            }
          },
          "additionalProperties": false
        },
        "minimum": {
          "type": "object",
          "required": [
            "title",
            "estimated_duration_minutes",
            "completion_criteria"
          ],
          "properties": {
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "estimated_duration_minutes": {
              "type": "integer",
              "minimum": 1,
              "maximum": 1440
            },
            "completion_criteria": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  }
} as const;

export type LightTickStarterCandidate = {
  "candidate_id": string;
  "title": string;
  "assumption": string;
  "variants": {
  "standard": {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "light": {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "minimum": {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
};
};

export const LightTickFirstActionRequestSchema = {
  "type": "object",
  "required": [
    "task_id",
    "base_version",
    "selected_variant",
    "actual_duration_minutes"
  ],
  "properties": {
    "task_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "selected_variant": {
      "type": "string",
      "enum": [
        "standard",
        "light",
        "minimum"
      ]
    },
    "actual_duration_minutes": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1440
    },
    "difficulty": {
      "enum": [
        "easy",
        "right",
        "hard"
      ]
    }
  },
  "additionalProperties": false
} as const;

export type LightTickFirstActionRequest = {
  "task_id": string;
  "base_version": number;
  "selected_variant": "standard" | "light" | "minimum";
  "actual_duration_minutes": number;
  "difficulty"?: "easy" | "right" | "hard";
};

export const LightTickCommitmentModeSchema = {
  "type": "string",
  "enum": [
    "recovery",
    "light",
    "standard",
    "sprint"
  ]
} as const;

export type LightTickCommitmentMode = "recovery" | "light" | "standard" | "sprint";

export const LightTickCommitmentRequestSchema = {
  "type": "object",
  "required": [
    "goal_id",
    "mode"
  ],
  "properties": {
    "goal_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "mode": {
      "type": "string",
      "enum": [
        "recovery",
        "light",
        "standard",
        "sprint"
      ]
    },
    "deep_planning": {
      "type": "boolean",
      "default": false
    }
  },
  "additionalProperties": false
} as const;

export type LightTickCommitmentRequest = {
  "goal_id": string;
  "mode": "recovery" | "light" | "standard" | "sprint";
  "deep_planning"?: boolean;
};

export const LightTickAvailabilityWindowSchema = {
  "type": "object",
  "required": [
    "weekday",
    "start_time",
    "end_time"
  ],
  "properties": {
    "weekday": {
      "type": "integer",
      "minimum": 1,
      "maximum": 7
    },
    "start_time": {
      "type": "string",
      "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
    },
    "end_time": {
      "type": "string",
      "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
    }
  },
  "additionalProperties": false
} as const;

export type LightTickAvailabilityWindow = {
  "weekday": number;
  "start_time": string;
  "end_time": string;
};

export const LightTickGoalStatusSchema = {
  "type": "string",
  "enum": [
    "draft",
    "active",
    "paused",
    "recovering",
    "completed",
    "archived"
  ]
} as const;

export type LightTickGoalStatus = "draft" | "active" | "paused" | "recovering" | "completed" | "archived";

export const LightTickGoalDataSchema = {
  "type": "object",
  "required": [
    "id",
    "title",
    "status",
    "constraints",
    "version",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "title": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "draft",
        "active",
        "paused",
        "recovering",
        "completed",
        "archived"
      ]
    },
    "target_date": {
      "type": "string",
      "format": "date"
    },
    "motivation": {
      "type": "string"
    },
    "constraints": {
      "type": "object",
      "required": [
        "weekly_available_minutes",
        "pace"
      ],
      "properties": {
        "current_level": {
          "type": "string",
          "maxLength": 500
        },
        "weekly_available_minutes": {
          "type": "integer",
          "minimum": 30,
          "maximum": 10080
        },
        "pace": {
          "type": "string",
          "enum": [
            "compact",
            "balanced",
            "relaxed"
          ]
        },
        "availability_windows": {
          "type": "array",
          "maxItems": 28,
          "items": {
            "type": "object",
            "required": [
              "weekday",
              "start_time",
              "end_time"
            ],
            "properties": {
              "weekday": {
                "type": "integer",
                "minimum": 1,
                "maximum": 7
              },
              "start_time": {
                "type": "string",
                "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
              },
              "end_time": {
                "type": "string",
                "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
              }
            },
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    },
    "pause_metadata": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string"
        },
        "paused_at": {
          "type": "string",
          "format": "date-time"
        },
        "expected_resume_at": {
          "type": "string",
          "format": "date-time"
        },
        "keep_light_tasks": {
          "type": "boolean"
        },
        "notification_policy": {
          "enum": [
            "suppress",
            "light_only"
          ]
        }
      }
    },
    "recovery_started_at": {
      "type": "string",
      "format": "date-time"
    },
    "version": {
      "type": "integer",
      "minimum": 1
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickGoalData = {
  "id": string;
  "title": string;
  "description"?: string;
  "status": "draft" | "active" | "paused" | "recovering" | "completed" | "archived";
  "target_date"?: string;
  "motivation"?: string;
  "constraints": {
  "current_level"?: string;
  "weekly_available_minutes": number;
  "pace": "compact" | "balanced" | "relaxed";
  "availability_windows"?: (
{
  "weekday": number;
  "start_time": string;
  "end_time": string;
}
)[];
};
  "pause_metadata"?: {
  "reason"?: string;
  "paused_at"?: string;
  "expected_resume_at"?: string;
  "keep_light_tasks"?: boolean;
  "notification_policy"?: "suppress" | "light_only";
};
  "recovery_started_at"?: string;
  "version": number;
  "created_at": string;
  "updated_at": string;
};

export const LightTickGoalConstraintsSchema = {
  "type": "object",
  "required": [
    "weekly_available_minutes",
    "pace"
  ],
  "properties": {
    "current_level": {
      "type": "string",
      "maxLength": 500
    },
    "weekly_available_minutes": {
      "type": "integer",
      "minimum": 30,
      "maximum": 10080
    },
    "pace": {
      "type": "string",
      "enum": [
        "compact",
        "balanced",
        "relaxed"
      ]
    },
    "availability_windows": {
      "type": "array",
      "maxItems": 28,
      "items": {
        "type": "object",
        "required": [
          "weekday",
          "start_time",
          "end_time"
        ],
        "properties": {
          "weekday": {
            "type": "integer",
            "minimum": 1,
            "maximum": 7
          },
          "start_time": {
            "type": "string",
            "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
          },
          "end_time": {
            "type": "string",
            "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
} as const;

export type LightTickGoalConstraints = {
  "current_level"?: string;
  "weekly_available_minutes": number;
  "pace": "compact" | "balanced" | "relaxed";
  "availability_windows"?: (
{
  "weekday": number;
  "start_time": string;
  "end_time": string;
}
)[];
};

export const LightTickGoalCreateRequestSchema = {
  "type": "object",
  "required": [
    "title",
    "constraints"
  ],
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "maxLength": 4000
    },
    "target_date": {
      "type": "string",
      "format": "date"
    },
    "motivation": {
      "type": "string",
      "maxLength": 4000
    },
    "constraints": {
      "type": "object",
      "required": [
        "weekly_available_minutes",
        "pace"
      ],
      "properties": {
        "current_level": {
          "type": "string",
          "maxLength": 500
        },
        "weekly_available_minutes": {
          "type": "integer",
          "minimum": 30,
          "maximum": 10080
        },
        "pace": {
          "type": "string",
          "enum": [
            "compact",
            "balanced",
            "relaxed"
          ]
        },
        "availability_windows": {
          "type": "array",
          "maxItems": 28,
          "items": {
            "type": "object",
            "required": [
              "weekday",
              "start_time",
              "end_time"
            ],
            "properties": {
              "weekday": {
                "type": "integer",
                "minimum": 1,
                "maximum": 7
              },
              "start_time": {
                "type": "string",
                "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
              },
              "end_time": {
                "type": "string",
                "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
              }
            },
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
} as const;

export type LightTickGoalCreateRequest = {
  "title": string;
  "description"?: string;
  "target_date"?: string;
  "motivation"?: string;
  "constraints": {
  "current_level"?: string;
  "weekly_available_minutes": number;
  "pace": "compact" | "balanced" | "relaxed";
  "availability_windows"?: (
{
  "weekday": number;
  "start_time": string;
  "end_time": string;
}
)[];
};
};

export const LightTickGoalUpdateRequestSchema = {
  "type": "object",
  "required": [
    "base_version"
  ],
  "properties": {
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "maxLength": 4000
    },
    "target_date": {
      "type": "string",
      "format": "date"
    },
    "motivation": {
      "type": "string",
      "maxLength": 4000
    },
    "constraints": {
      "type": "object",
      "required": [
        "weekly_available_minutes",
        "pace"
      ],
      "properties": {
        "current_level": {
          "type": "string",
          "maxLength": 500
        },
        "weekly_available_minutes": {
          "type": "integer",
          "minimum": 30,
          "maximum": 10080
        },
        "pace": {
          "type": "string",
          "enum": [
            "compact",
            "balanced",
            "relaxed"
          ]
        },
        "availability_windows": {
          "type": "array",
          "maxItems": 28,
          "items": {
            "type": "object",
            "required": [
              "weekday",
              "start_time",
              "end_time"
            ],
            "properties": {
              "weekday": {
                "type": "integer",
                "minimum": 1,
                "maximum": 7
              },
              "start_time": {
                "type": "string",
                "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
              },
              "end_time": {
                "type": "string",
                "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
              }
            },
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
} as const;

export type LightTickGoalUpdateRequest = {
  "base_version": number;
  "title"?: string;
  "description"?: string;
  "target_date"?: string;
  "motivation"?: string;
  "constraints"?: {
  "current_level"?: string;
  "weekly_available_minutes": number;
  "pace": "compact" | "balanced" | "relaxed";
  "availability_windows"?: (
{
  "weekday": number;
  "start_time": string;
  "end_time": string;
}
)[];
};
};

export const LightTickGoalLifecycleRequestSchema = {
  "type": "object",
  "required": [
    "base_version",
    "action"
  ],
  "properties": {
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "action": {
      "enum": [
        "pause",
        "resume",
        "complete",
        "archive"
      ]
    },
    "reason": {
      "type": "string",
      "maxLength": 1000
    },
    "expected_resume_at": {
      "type": "string",
      "format": "date-time"
    },
    "keep_light_tasks": {
      "type": "boolean"
    },
    "notification_policy": {
      "enum": [
        "suppress",
        "light_only"
      ]
    },
    "resume_mode": {
      "enum": [
        "original_pace",
        "recovery_mode",
        "adjust_goal"
      ]
    }
  },
  "additionalProperties": false
} as const;

export type LightTickGoalLifecycleRequest = {
  "base_version": number;
  "action": "pause" | "resume" | "complete" | "archive";
  "reason"?: string;
  "expected_resume_at"?: string;
  "keep_light_tasks"?: boolean;
  "notification_policy"?: "suppress" | "light_only";
  "resume_mode"?: "original_pace" | "recovery_mode" | "adjust_goal";
};

export const LightTickPlanGranularitySchema = {
  "type": "string",
  "enum": [
    "month",
    "week",
    "day"
  ]
} as const;

export type LightTickPlanGranularity = "month" | "week" | "day";

export const LightTickPlanStatusSchema = {
  "type": "string",
  "enum": [
    "generating",
    "proposed",
    "active",
    "superseded",
    "failed"
  ]
} as const;

export type LightTickPlanStatus = "generating" | "proposed" | "active" | "superseded" | "failed";

export const LightTickPlanRunRequestSchema = {
  "type": "object",
  "required": [
    "goal_id",
    "granularity",
    "period_start",
    "period_end"
  ],
  "properties": {
    "goal_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "base_plan_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "granularity": {
      "type": "string",
      "enum": [
        "month",
        "week",
        "day"
      ]
    },
    "period_start": {
      "type": "string",
      "format": "date"
    },
    "period_end": {
      "type": "string",
      "format": "date"
    },
    "available_minutes": {
      "type": "integer",
      "minimum": 0,
      "maximum": 10080
    }
  },
  "additionalProperties": false
} as const;

export type LightTickPlanRunRequest = {
  "goal_id": string;
  "base_plan_id"?: string;
  "base_version"?: number;
  "granularity": "month" | "week" | "day";
  "period_start": string;
  "period_end": string;
  "available_minutes"?: number;
};

export const LightTickPlanDataSchema = {
  "type": "object",
  "required": [
    "id",
    "goal_id",
    "granularity",
    "status",
    "period_start",
    "period_end",
    "source",
    "version",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "goal_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "parent_plan_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "granularity": {
      "type": "string",
      "enum": [
        "month",
        "week",
        "day"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "generating",
        "proposed",
        "active",
        "superseded",
        "failed"
      ]
    },
    "period_start": {
      "type": "string",
      "format": "date"
    },
    "period_end": {
      "type": "string",
      "format": "date"
    },
    "title": {
      "type": "string"
    },
    "summary": {
      "type": "string"
    },
    "source": {
      "enum": [
        "ai",
        "template",
        "manual"
      ]
    },
    "proposal": {
      "type": "object",
      "description": "Persisted plan preview including proposed tasks and non-secret planning assumptions.",
      "additionalProperties": true
    },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "plan_id",
          "title",
          "status",
          "scheduled_date",
          "estimated_duration_minutes",
          "priority",
          "version",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "lineage_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "plan_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "title": {
            "type": "string"
          },
          "completion_criteria": {
            "type": "string"
          },
          "selected_variant": {
            "type": "string",
            "enum": [
              "standard",
              "light",
              "minimum"
            ]
          },
          "variants": {
            "type": "object",
            "properties": {
              "standard": {
                "type": "object",
                "required": [
                  "title",
                  "estimated_duration_minutes",
                  "completion_criteria"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "estimated_duration_minutes": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1440
                  },
                  "completion_criteria": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000
                  }
                },
                "additionalProperties": false
              },
              "light": {
                "type": "object",
                "required": [
                  "title",
                  "estimated_duration_minutes",
                  "completion_criteria"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "estimated_duration_minutes": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1440
                  },
                  "completion_criteria": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000
                  }
                },
                "additionalProperties": false
              },
              "minimum": {
                "type": "object",
                "required": [
                  "title",
                  "estimated_duration_minutes",
                  "completion_criteria"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "estimated_duration_minutes": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1440
                  },
                  "completion_criteria": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000
                  }
                },
                "additionalProperties": false
              }
            }
          },
          "commitment_satisfied": {
            "type": "boolean"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "in_progress",
              "completed",
              "skipped",
              "deferred",
              "cancelled"
            ]
          },
          "difficulty": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high"
            ]
          },
          "scheduled_date": {
            "type": "string",
            "format": "date"
          },
          "estimated_duration_minutes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1440
          },
          "actual_duration_minutes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1440
          },
          "priority": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "steps": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "id",
                "title",
                "completed",
                "position"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 8,
                  "maxLength": 128,
                  "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
                },
                "title": {
                  "type": "string"
                },
                "completed": {
                  "type": "boolean"
                },
                "position": {
                  "type": "integer",
                  "minimum": 0
                }
              }
            }
          },
          "completed_at": {
            "type": "string",
            "format": "date-time"
          },
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    },
    "version": {
      "type": "integer",
      "minimum": 1
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickPlanData = {
  "id": string;
  "goal_id": string;
  "parent_plan_id"?: string;
  "granularity": "month" | "week" | "day";
  "status": "generating" | "proposed" | "active" | "superseded" | "failed";
  "period_start": string;
  "period_end": string;
  "title"?: string;
  "summary"?: string;
  "source": "ai" | "template" | "manual";
  "proposal"?: {
  [key: string]: unknown;
};
  "tasks"?: (
{
  "id": string;
  "lineage_id"?: string;
  "plan_id": string;
  "title": string;
  "completion_criteria"?: string;
  "selected_variant"?: "standard" | "light" | "minimum";
  "variants"?: {
  "standard"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "light"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "minimum"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
};
  "commitment_satisfied"?: boolean;
  "status": "pending" | "in_progress" | "completed" | "skipped" | "deferred" | "cancelled";
  "difficulty"?: "low" | "medium" | "high";
  "scheduled_date": string;
  "estimated_duration_minutes": number;
  "actual_duration_minutes"?: number;
  "priority": number;
  "steps"?: (
{
  "id": string;
  "title": string;
  "completed": boolean;
  "position": number;
}
)[];
  "completed_at"?: string;
  "version": number;
  "created_at": string;
  "updated_at": string;
}
)[];
  "version": number;
  "created_at": string;
  "updated_at": string;
};

export const LightTickTaskStatusSchema = {
  "type": "string",
  "enum": [
    "pending",
    "in_progress",
    "completed",
    "skipped",
    "deferred",
    "cancelled"
  ]
} as const;

export type LightTickTaskStatus = "pending" | "in_progress" | "completed" | "skipped" | "deferred" | "cancelled";

export const LightTickTaskDifficultySchema = {
  "type": "string",
  "enum": [
    "low",
    "medium",
    "high"
  ]
} as const;

export type LightTickTaskDifficulty = "low" | "medium" | "high";

export const LightTickTaskDataSchema = {
  "type": "object",
  "required": [
    "id",
    "plan_id",
    "title",
    "status",
    "scheduled_date",
    "estimated_duration_minutes",
    "priority",
    "version",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "lineage_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "plan_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "title": {
      "type": "string"
    },
    "completion_criteria": {
      "type": "string"
    },
    "selected_variant": {
      "type": "string",
      "enum": [
        "standard",
        "light",
        "minimum"
      ]
    },
    "variants": {
      "type": "object",
      "properties": {
        "standard": {
          "type": "object",
          "required": [
            "title",
            "estimated_duration_minutes",
            "completion_criteria"
          ],
          "properties": {
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "estimated_duration_minutes": {
              "type": "integer",
              "minimum": 1,
              "maximum": 1440
            },
            "completion_criteria": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000
            }
          },
          "additionalProperties": false
        },
        "light": {
          "type": "object",
          "required": [
            "title",
            "estimated_duration_minutes",
            "completion_criteria"
          ],
          "properties": {
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "estimated_duration_minutes": {
              "type": "integer",
              "minimum": 1,
              "maximum": 1440
            },
            "completion_criteria": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000
            }
          },
          "additionalProperties": false
        },
        "minimum": {
          "type": "object",
          "required": [
            "title",
            "estimated_duration_minutes",
            "completion_criteria"
          ],
          "properties": {
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "estimated_duration_minutes": {
              "type": "integer",
              "minimum": 1,
              "maximum": 1440
            },
            "completion_criteria": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000
            }
          },
          "additionalProperties": false
        }
      }
    },
    "commitment_satisfied": {
      "type": "boolean"
    },
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "in_progress",
        "completed",
        "skipped",
        "deferred",
        "cancelled"
      ]
    },
    "difficulty": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "scheduled_date": {
      "type": "string",
      "format": "date"
    },
    "estimated_duration_minutes": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1440
    },
    "actual_duration_minutes": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1440
    },
    "priority": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1000
    },
    "steps": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "title",
          "completed",
          "position"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "title": {
            "type": "string"
          },
          "completed": {
            "type": "boolean"
          },
          "position": {
            "type": "integer",
            "minimum": 0
          }
        }
      }
    },
    "completed_at": {
      "type": "string",
      "format": "date-time"
    },
    "version": {
      "type": "integer",
      "minimum": 1
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickTaskData = {
  "id": string;
  "lineage_id"?: string;
  "plan_id": string;
  "title": string;
  "completion_criteria"?: string;
  "selected_variant"?: "standard" | "light" | "minimum";
  "variants"?: {
  "standard"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "light"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "minimum"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
};
  "commitment_satisfied"?: boolean;
  "status": "pending" | "in_progress" | "completed" | "skipped" | "deferred" | "cancelled";
  "difficulty"?: "low" | "medium" | "high";
  "scheduled_date": string;
  "estimated_duration_minutes": number;
  "actual_duration_minutes"?: number;
  "priority": number;
  "steps"?: (
{
  "id": string;
  "title": string;
  "completed": boolean;
  "position": number;
}
)[];
  "completed_at"?: string;
  "version": number;
  "created_at": string;
  "updated_at": string;
};

export const LightTickTaskStepDataSchema = {
  "type": "object",
  "required": [
    "id",
    "title",
    "completed",
    "position"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "title": {
      "type": "string"
    },
    "completed": {
      "type": "boolean"
    },
    "position": {
      "type": "integer",
      "minimum": 0
    }
  }
} as const;

export type LightTickTaskStepData = {
  "id": string;
  "title": string;
  "completed": boolean;
  "position": number;
};

export const LightTickVersionedCommandRequestSchema = {
  "type": "object",
  "required": [
    "base_version"
  ],
  "properties": {
    "base_version": {
      "type": "integer",
      "minimum": 1
    }
  },
  "additionalProperties": false
} as const;

export type LightTickVersionedCommandRequest = {
  "base_version": number;
};

export const LightTickTaskCompleteRequestSchema = {
  "type": "object",
  "required": [
    "base_version"
  ],
  "properties": {
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "actual_duration_minutes": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1440
    },
    "difficulty": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "note": {
      "type": "string",
      "maxLength": 4000
    },
    "client_occurred_at": {
      "type": "string",
      "format": "date-time"
    }
  },
  "additionalProperties": false
} as const;

export type LightTickTaskCompleteRequest = {
  "base_version": number;
  "actual_duration_minutes"?: number;
  "difficulty"?: "low" | "medium" | "high";
  "note"?: string;
  "client_occurred_at"?: string;
};

export const LightTickSkipReasonSchema = {
  "type": "string",
  "enum": [
    "no_time",
    "too_difficult",
    "low_energy",
    "no_longer_relevant",
    "blocked",
    "other"
  ]
} as const;

export type LightTickSkipReason = "no_time" | "too_difficult" | "low_energy" | "no_longer_relevant" | "blocked" | "other";

export const LightTickTaskSkipRequestSchema = {
  "type": "object",
  "required": [
    "base_version",
    "reason_code"
  ],
  "properties": {
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "reason_code": {
      "type": "string",
      "enum": [
        "no_time",
        "too_difficult",
        "low_energy",
        "no_longer_relevant",
        "blocked",
        "other"
      ]
    },
    "reason_note": {
      "type": "string",
      "maxLength": 2000
    },
    "client_occurred_at": {
      "type": "string",
      "format": "date-time"
    }
  },
  "additionalProperties": false
} as const;

export type LightTickTaskSkipRequest = {
  "base_version": number;
  "reason_code": "no_time" | "too_difficult" | "low_energy" | "no_longer_relevant" | "blocked" | "other";
  "reason_note"?: string;
  "client_occurred_at"?: string;
};

export const LightTickTaskDeferRequestSchema = {
  "type": "object",
  "required": [
    "base_version",
    "target_date",
    "timezone"
  ],
  "properties": {
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "target_date": {
      "type": "string",
      "format": "date"
    },
    "timezone": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "IANA timezone identifier such as Asia/Shanghai."
    },
    "reason_code": {
      "type": "string",
      "enum": [
        "no_time",
        "too_difficult",
        "low_energy",
        "no_longer_relevant",
        "blocked",
        "other"
      ]
    },
    "reason_note": {
      "type": "string",
      "maxLength": 2000
    },
    "client_occurred_at": {
      "type": "string",
      "format": "date-time"
    }
  },
  "additionalProperties": false
} as const;

export type LightTickTaskDeferRequest = {
  "base_version": number;
  "target_date": string;
  "timezone": string;
  "reason_code"?: "no_time" | "too_difficult" | "low_energy" | "no_longer_relevant" | "blocked" | "other";
  "reason_note"?: string;
  "client_occurred_at"?: string;
};

export const LightTickTaskVariantRequestSchema = {
  "type": "object",
  "required": [
    "base_version",
    "variant"
  ],
  "properties": {
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "variant": {
      "type": "string",
      "enum": [
        "standard",
        "light",
        "minimum"
      ]
    }
  },
  "additionalProperties": false
} as const;

export type LightTickTaskVariantRequest = {
  "base_version": number;
  "variant": "standard" | "light" | "minimum";
};

export const LightTickTodayDataSchema = {
  "type": "object",
  "required": [
    "business_date",
    "timezone",
    "tasks",
    "remaining_estimated_minutes",
    "plan_b_available",
    "snapshot_version"
  ],
  "properties": {
    "business_date": {
      "type": "string",
      "format": "date"
    },
    "timezone": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "IANA timezone identifier such as Asia/Shanghai."
    },
    "primary_task": {
      "type": "object",
      "required": [
        "id",
        "plan_id",
        "title",
        "status",
        "scheduled_date",
        "estimated_duration_minutes",
        "priority",
        "version",
        "created_at",
        "updated_at"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "lineage_id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "plan_id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "title": {
          "type": "string"
        },
        "completion_criteria": {
          "type": "string"
        },
        "selected_variant": {
          "type": "string",
          "enum": [
            "standard",
            "light",
            "minimum"
          ]
        },
        "variants": {
          "type": "object",
          "properties": {
            "standard": {
              "type": "object",
              "required": [
                "title",
                "estimated_duration_minutes",
                "completion_criteria"
              ],
              "properties": {
                "title": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                },
                "estimated_duration_minutes": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 1440
                },
                "completion_criteria": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 1000
                }
              },
              "additionalProperties": false
            },
            "light": {
              "type": "object",
              "required": [
                "title",
                "estimated_duration_minutes",
                "completion_criteria"
              ],
              "properties": {
                "title": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                },
                "estimated_duration_minutes": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 1440
                },
                "completion_criteria": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 1000
                }
              },
              "additionalProperties": false
            },
            "minimum": {
              "type": "object",
              "required": [
                "title",
                "estimated_duration_minutes",
                "completion_criteria"
              ],
              "properties": {
                "title": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                },
                "estimated_duration_minutes": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 1440
                },
                "completion_criteria": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 1000
                }
              },
              "additionalProperties": false
            }
          }
        },
        "commitment_satisfied": {
          "type": "boolean"
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "in_progress",
            "completed",
            "skipped",
            "deferred",
            "cancelled"
          ]
        },
        "difficulty": {
          "type": "string",
          "enum": [
            "low",
            "medium",
            "high"
          ]
        },
        "scheduled_date": {
          "type": "string",
          "format": "date"
        },
        "estimated_duration_minutes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1440
        },
        "actual_duration_minutes": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1440
        },
        "priority": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1000
        },
        "steps": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "id",
              "title",
              "completed",
              "position"
            ],
            "properties": {
              "id": {
                "type": "string",
                "minLength": 8,
                "maxLength": 128,
                "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
              },
              "title": {
                "type": "string"
              },
              "completed": {
                "type": "boolean"
              },
              "position": {
                "type": "integer",
                "minimum": 0
              }
            }
          }
        },
        "completed_at": {
          "type": "string",
          "format": "date-time"
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "created_at": {
          "type": "string",
          "format": "date-time"
        },
        "updated_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "plan_id",
          "title",
          "status",
          "scheduled_date",
          "estimated_duration_minutes",
          "priority",
          "version",
          "created_at",
          "updated_at"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "lineage_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "plan_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "title": {
            "type": "string"
          },
          "completion_criteria": {
            "type": "string"
          },
          "selected_variant": {
            "type": "string",
            "enum": [
              "standard",
              "light",
              "minimum"
            ]
          },
          "variants": {
            "type": "object",
            "properties": {
              "standard": {
                "type": "object",
                "required": [
                  "title",
                  "estimated_duration_minutes",
                  "completion_criteria"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "estimated_duration_minutes": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1440
                  },
                  "completion_criteria": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000
                  }
                },
                "additionalProperties": false
              },
              "light": {
                "type": "object",
                "required": [
                  "title",
                  "estimated_duration_minutes",
                  "completion_criteria"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "estimated_duration_minutes": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1440
                  },
                  "completion_criteria": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000
                  }
                },
                "additionalProperties": false
              },
              "minimum": {
                "type": "object",
                "required": [
                  "title",
                  "estimated_duration_minutes",
                  "completion_criteria"
                ],
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "estimated_duration_minutes": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1440
                  },
                  "completion_criteria": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000
                  }
                },
                "additionalProperties": false
              }
            }
          },
          "commitment_satisfied": {
            "type": "boolean"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "in_progress",
              "completed",
              "skipped",
              "deferred",
              "cancelled"
            ]
          },
          "difficulty": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high"
            ]
          },
          "scheduled_date": {
            "type": "string",
            "format": "date"
          },
          "estimated_duration_minutes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1440
          },
          "actual_duration_minutes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1440
          },
          "priority": {
            "type": "integer",
            "minimum": 0,
            "maximum": 1000
          },
          "steps": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "id",
                "title",
                "completed",
                "position"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 8,
                  "maxLength": 128,
                  "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
                },
                "title": {
                  "type": "string"
                },
                "completed": {
                  "type": "boolean"
                },
                "position": {
                  "type": "integer",
                  "minimum": 0
                }
              }
            }
          },
          "completed_at": {
            "type": "string",
            "format": "date-time"
          },
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          },
          "updated_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    },
    "remaining_estimated_minutes": {
      "type": "integer",
      "minimum": 0
    },
    "plan_b_available": {
      "type": "boolean"
    },
    "empty_state_action": {
      "enum": [
        "create_goal",
        "generate_plan",
        "resume_goal",
        "rest",
        "none"
      ]
    },
    "snapshot_version": {
      "type": "integer",
      "minimum": 0
    }
  }
} as const;

export type LightTickTodayData = {
  "business_date": string;
  "timezone": string;
  "primary_task"?: {
  "id": string;
  "lineage_id"?: string;
  "plan_id": string;
  "title": string;
  "completion_criteria"?: string;
  "selected_variant"?: "standard" | "light" | "minimum";
  "variants"?: {
  "standard"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "light"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "minimum"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
};
  "commitment_satisfied"?: boolean;
  "status": "pending" | "in_progress" | "completed" | "skipped" | "deferred" | "cancelled";
  "difficulty"?: "low" | "medium" | "high";
  "scheduled_date": string;
  "estimated_duration_minutes": number;
  "actual_duration_minutes"?: number;
  "priority": number;
  "steps"?: (
{
  "id": string;
  "title": string;
  "completed": boolean;
  "position": number;
}
)[];
  "completed_at"?: string;
  "version": number;
  "created_at": string;
  "updated_at": string;
};
  "tasks": (
{
  "id": string;
  "lineage_id"?: string;
  "plan_id": string;
  "title": string;
  "completion_criteria"?: string;
  "selected_variant"?: "standard" | "light" | "minimum";
  "variants"?: {
  "standard"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "light"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
  "minimum"?: {
  "title": string;
  "estimated_duration_minutes": number;
  "completion_criteria": string;
};
};
  "commitment_satisfied"?: boolean;
  "status": "pending" | "in_progress" | "completed" | "skipped" | "deferred" | "cancelled";
  "difficulty"?: "low" | "medium" | "high";
  "scheduled_date": string;
  "estimated_duration_minutes": number;
  "actual_duration_minutes"?: number;
  "priority": number;
  "steps"?: (
{
  "id": string;
  "title": string;
  "completed": boolean;
  "position": number;
}
)[];
  "completed_at"?: string;
  "version": number;
  "created_at": string;
  "updated_at": string;
}
)[];
  "remaining_estimated_minutes": number;
  "plan_b_available": boolean;
  "empty_state_action"?: "create_goal" | "generate_plan" | "resume_goal" | "rest" | "none";
  "snapshot_version": number;
};

export const LightTickReviewPeriodSchema = {
  "type": "string",
  "enum": [
    "weekly",
    "monthly"
  ]
} as const;

export type LightTickReviewPeriod = "weekly" | "monthly";

export const LightTickReviewStatusSchema = {
  "type": "string",
  "enum": [
    "generating",
    "ready",
    "acknowledged",
    "failed"
  ]
} as const;

export type LightTickReviewStatus = "generating" | "ready" | "acknowledged" | "failed";

export const LightTickReviewRunRequestSchema = {
  "type": "object",
  "required": [
    "goal_id",
    "period",
    "period_start",
    "period_end"
  ],
  "properties": {
    "goal_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "period": {
      "type": "string",
      "enum": [
        "weekly",
        "monthly"
      ]
    },
    "period_start": {
      "type": "string",
      "format": "date"
    },
    "period_end": {
      "type": "string",
      "format": "date"
    },
    "mood": {
      "type": "string",
      "maxLength": 100
    },
    "self_reflection": {
      "type": "string",
      "maxLength": 4000
    }
  },
  "additionalProperties": false
} as const;

export type LightTickReviewRunRequest = {
  "goal_id": string;
  "period": "weekly" | "monthly";
  "period_start": string;
  "period_end": string;
  "mood"?: string;
  "self_reflection"?: string;
};

export const LightTickReviewDataSchema = {
  "type": "object",
  "required": [
    "id",
    "goal_id",
    "period",
    "status",
    "period_start",
    "period_end",
    "facts",
    "data_sufficiency",
    "version",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "goal_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "period": {
      "type": "string",
      "enum": [
        "weekly",
        "monthly"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "generating",
        "ready",
        "acknowledged",
        "failed"
      ]
    },
    "period_start": {
      "type": "string",
      "format": "date"
    },
    "period_end": {
      "type": "string",
      "format": "date"
    },
    "facts": {
      "type": "object",
      "additionalProperties": true
    },
    "insights": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "recommendations": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "data_sufficiency": {
      "enum": [
        "insufficient",
        "basic",
        "sufficient"
      ]
    },
    "linked_proposal_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "version": {
      "type": "integer",
      "minimum": 1
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickReviewData = {
  "id": string;
  "goal_id": string;
  "period": "weekly" | "monthly";
  "status": "generating" | "ready" | "acknowledged" | "failed";
  "period_start": string;
  "period_end": string;
  "facts": {
  [key: string]: unknown;
};
  "insights"?: string[];
  "recommendations"?: string[];
  "data_sufficiency": "insufficient" | "basic" | "sufficient";
  "linked_proposal_id"?: string;
  "version": number;
  "created_at": string;
  "updated_at": string;
};

export const LightTickChangeProposalRunRequestSchema = {
  "type": "object",
  "required": [
    "plan_id",
    "base_version",
    "reason"
  ],
  "properties": {
    "plan_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "reason": {
      "enum": [
        "user_request",
        "low_completion",
        "return_after_break",
        "low_energy",
        "schedule_change"
      ]
    },
    "remaining_available_minutes": {
      "type": "integer",
      "minimum": 0,
      "maximum": 10080
    },
    "mood": {
      "type": "string",
      "maxLength": 100
    },
    "user_context": {
      "type": "string",
      "maxLength": 4000
    }
  },
  "additionalProperties": false
} as const;

export type LightTickChangeProposalRunRequest = {
  "plan_id": string;
  "base_version": number;
  "reason": "user_request" | "low_completion" | "return_after_break" | "low_energy" | "schedule_change";
  "remaining_available_minutes"?: number;
  "mood"?: string;
  "user_context"?: string;
};

export const LightTickProposalStatusSchema = {
  "type": "string",
  "enum": [
    "pending",
    "accepted",
    "rejected",
    "expired",
    "superseded"
  ]
} as const;

export type LightTickProposalStatus = "pending" | "accepted" | "rejected" | "expired" | "superseded";

export const LightTickChangeProposalDataSchema = {
  "type": "object",
  "required": [
    "id",
    "plan_id",
    "base_plan_version",
    "status",
    "reason",
    "diff",
    "impact",
    "expires_at",
    "version",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "plan_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "base_plan_version": {
      "type": "integer",
      "minimum": 1
    },
    "status": {
      "type": "string",
      "enum": [
        "pending",
        "accepted",
        "rejected",
        "expired",
        "superseded"
      ]
    },
    "reason": {
      "type": "string"
    },
    "diff": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "operation",
          "entity_type",
          "entity_id"
        ],
        "properties": {
          "operation": {
            "enum": [
              "add",
              "update",
              "defer",
              "cancel"
            ]
          },
          "entity_type": {
            "enum": [
              "goal",
              "plan",
              "task"
            ]
          },
          "entity_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "before": {
            "type": "object",
            "additionalProperties": true
          },
          "after": {
            "type": "object",
            "additionalProperties": true
          }
        }
      }
    },
    "impact": {
      "type": "object",
      "required": [
        "task_count_delta",
        "total_minutes_delta",
        "commitment_boundary_changed"
      ],
      "properties": {
        "task_count_delta": {
          "type": "integer"
        },
        "total_minutes_delta": {
          "type": "integer"
        },
        "commitment_boundary_changed": {
          "type": "boolean"
        },
        "summary": {
          "type": "string"
        }
      }
    },
    "expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "version": {
      "type": "integer",
      "minimum": 1
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickChangeProposalData = {
  "id": string;
  "plan_id": string;
  "base_plan_version": number;
  "status": "pending" | "accepted" | "rejected" | "expired" | "superseded";
  "reason": string;
  "diff": (
{
  "operation": "add" | "update" | "defer" | "cancel";
  "entity_type": "goal" | "plan" | "task";
  "entity_id": string;
  "before"?: {
  [key: string]: unknown;
};
  "after"?: {
  [key: string]: unknown;
};
}
)[];
  "impact": {
  "task_count_delta": number;
  "total_minutes_delta": number;
  "commitment_boundary_changed": boolean;
  "summary"?: string;
};
  "expires_at": string;
  "version": number;
  "created_at": string;
  "updated_at": string;
};

export const LightTickPlanDiffItemSchema = {
  "type": "object",
  "required": [
    "operation",
    "entity_type",
    "entity_id"
  ],
  "properties": {
    "operation": {
      "enum": [
        "add",
        "update",
        "defer",
        "cancel"
      ]
    },
    "entity_type": {
      "enum": [
        "goal",
        "plan",
        "task"
      ]
    },
    "entity_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "before": {
      "type": "object",
      "additionalProperties": true
    },
    "after": {
      "type": "object",
      "additionalProperties": true
    }
  }
} as const;

export type LightTickPlanDiffItem = {
  "operation": "add" | "update" | "defer" | "cancel";
  "entity_type": "goal" | "plan" | "task";
  "entity_id": string;
  "before"?: {
  [key: string]: unknown;
};
  "after"?: {
  [key: string]: unknown;
};
};

export const LightTickProposalImpactSchema = {
  "type": "object",
  "required": [
    "task_count_delta",
    "total_minutes_delta",
    "commitment_boundary_changed"
  ],
  "properties": {
    "task_count_delta": {
      "type": "integer"
    },
    "total_minutes_delta": {
      "type": "integer"
    },
    "commitment_boundary_changed": {
      "type": "boolean"
    },
    "summary": {
      "type": "string"
    }
  }
} as const;

export type LightTickProposalImpact = {
  "task_count_delta": number;
  "total_minutes_delta": number;
  "commitment_boundary_changed": boolean;
  "summary"?: string;
};

export const LightTickProposalRejectRequestSchema = {
  "type": "object",
  "required": [
    "base_version"
  ],
  "properties": {
    "base_version": {
      "type": "integer",
      "minimum": 1
    },
    "reason": {
      "type": "string",
      "maxLength": 1000
    }
  },
  "additionalProperties": false
} as const;

export type LightTickProposalRejectRequest = {
  "base_version": number;
  "reason"?: string;
};

export const LightTickRunKindSchema = {
  "type": "string",
  "enum": [
    "onboarding_plan",
    "plan",
    "review",
    "change_proposal",
    "coach_reply"
  ]
} as const;

export type LightTickRunKind = "onboarding_plan" | "plan" | "review" | "change_proposal" | "coach_reply";

export const LightTickRunStatusSchema = {
  "type": "string",
  "enum": [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled"
  ]
} as const;

export type LightTickRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export const LightTickRunDataSchema = {
  "type": "object",
  "required": [
    "id",
    "kind",
    "scene",
    "status",
    "retryable",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "kind": {
      "type": "string",
      "enum": [
        "onboarding_plan",
        "plan",
        "review",
        "change_proposal",
        "coach_reply"
      ]
    },
    "scene": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled"
      ]
    },
    "retryable": {
      "type": "boolean"
    },
    "result_resource_type": {
      "enum": [
        "goal",
        "plan",
        "review",
        "change_proposal",
        "coach_message"
      ]
    },
    "result_resource_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "source": {
      "enum": [
        "ai",
        "template",
        "manual"
      ]
    },
    "error_code": {
      "type": "string",
      "enum": [
        "REQ_INVALID_BODY",
        "REQ_FIELD_REQUIRED",
        "REQ_FIELD_INVALID",
        "AUTH_REQUIRED",
        "AUTH_TOKEN_INVALID",
        "AUTH_SESSION_REVOKED",
        "APP_SCOPE_FORBIDDEN",
        "APP_MEMBER_INACTIVE",
        "LIGHTTICK_APP_DISABLED",
        "LIGHTTICK_GUEST_SESSION_EXPIRED",
        "LIGHTTICK_GUEST_UPGRADE_INVALID",
        "LIGHTTICK_GUEST_CREDENTIAL_INVALID",
        "LIGHTTICK_GUEST_EXPIRED",
        "LIGHTTICK_GUEST_REVOKED",
        "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
        "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED",
        "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED",
        "LIGHTTICK_REAUTH_REQUIRED",
        "LIGHTTICK_APP_ACCESS_DENIED",
        "LIGHTTICK_RESOURCE_NOT_FOUND",
        "LIGHTTICK_STATE_TRANSITION_INVALID",
        "LIGHTTICK_VERSION_CONFLICT",
        "LIGHTTICK_IDEMPOTENCY_MISMATCH",
        "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
        "LIGHTTICK_AI_RUN_FAILED",
        "LIGHTTICK_AI_UNAVAILABLE",
        "LIGHTTICK_AI_QUOTA_EXCEEDED",
        "LIGHTTICK_RUN_NOT_READY",
        "LIGHTTICK_PROPOSAL_STALE",
        "LIGHTTICK_PROPOSAL_NOT_PENDING",
        "LIGHTTICK_SYNC_CURSOR_INVALID",
        "LIGHTTICK_SYNC_BATCH_TOO_LARGE",
        "LIGHTTICK_SYNC_OPERATION_REJECTED",
        "LIGHTTICK_TIMEZONE_INVALID",
        "RATE_LIMITED",
        "INTERNAL_ERROR"
      ]
    },
    "result": {
      "type": "object",
      "additionalProperties": true
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickRunData = {
  "id": string;
  "kind": "onboarding_plan" | "plan" | "review" | "change_proposal" | "coach_reply";
  "scene": string;
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "retryable": boolean;
  "result_resource_type"?: "goal" | "plan" | "review" | "change_proposal" | "coach_message";
  "result_resource_id"?: string;
  "source"?: "ai" | "template" | "manual";
  "error_code"?: "REQ_INVALID_BODY" | "REQ_FIELD_REQUIRED" | "REQ_FIELD_INVALID" | "AUTH_REQUIRED" | "AUTH_TOKEN_INVALID" | "AUTH_SESSION_REVOKED" | "APP_SCOPE_FORBIDDEN" | "APP_MEMBER_INACTIVE" | "LIGHTTICK_APP_DISABLED" | "LIGHTTICK_GUEST_SESSION_EXPIRED" | "LIGHTTICK_GUEST_UPGRADE_INVALID" | "LIGHTTICK_GUEST_CREDENTIAL_INVALID" | "LIGHTTICK_GUEST_EXPIRED" | "LIGHTTICK_GUEST_REVOKED" | "LIGHTTICK_GUEST_UPGRADE_CONFLICT" | "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED" | "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED" | "LIGHTTICK_REAUTH_REQUIRED" | "LIGHTTICK_APP_ACCESS_DENIED" | "LIGHTTICK_RESOURCE_NOT_FOUND" | "LIGHTTICK_STATE_TRANSITION_INVALID" | "LIGHTTICK_VERSION_CONFLICT" | "LIGHTTICK_IDEMPOTENCY_MISMATCH" | "LIGHTTICK_PLAN_CONSTRAINT_FAILED" | "LIGHTTICK_AI_RUN_FAILED" | "LIGHTTICK_AI_UNAVAILABLE" | "LIGHTTICK_AI_QUOTA_EXCEEDED" | "LIGHTTICK_RUN_NOT_READY" | "LIGHTTICK_PROPOSAL_STALE" | "LIGHTTICK_PROPOSAL_NOT_PENDING" | "LIGHTTICK_SYNC_CURSOR_INVALID" | "LIGHTTICK_SYNC_BATCH_TOO_LARGE" | "LIGHTTICK_SYNC_OPERATION_REJECTED" | "LIGHTTICK_TIMEZONE_INVALID" | "RATE_LIMITED" | "INTERNAL_ERROR";
  "result"?: {
  [key: string]: unknown;
};
  "created_at": string;
  "updated_at": string;
};

export const LightTickSyncEntityTypeSchema = {
  "type": "string",
  "enum": [
    "profile",
    "goal",
    "plan",
    "task",
    "task_step",
    "review",
    "change_proposal"
  ]
} as const;

export type LightTickSyncEntityType = "profile" | "goal" | "plan" | "task" | "task_step" | "review" | "change_proposal";

export const LightTickSyncActionSchema = {
  "type": "string",
  "enum": [
    "create",
    "update",
    "start",
    "complete",
    "skip",
    "defer",
    "cancel",
    "accept",
    "reject",
    "delete"
  ]
} as const;

export type LightTickSyncAction = "create" | "update" | "start" | "complete" | "skip" | "defer" | "cancel" | "accept" | "reject" | "delete";

export const LightTickSyncOperationSchema = {
  "type": "object",
  "required": [
    "operation_id",
    "device_id",
    "entity_type",
    "entity_id",
    "action",
    "base_version",
    "client_occurred_at",
    "payload"
  ],
  "properties": {
    "operation_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "device_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "entity_type": {
      "type": "string",
      "enum": [
        "profile",
        "goal",
        "plan",
        "task",
        "task_step",
        "review",
        "change_proposal"
      ]
    },
    "entity_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "action": {
      "type": "string",
      "enum": [
        "create",
        "update",
        "start",
        "complete",
        "skip",
        "defer",
        "cancel",
        "accept",
        "reject",
        "delete"
      ]
    },
    "base_version": {
      "type": "integer",
      "minimum": 0
    },
    "client_occurred_at": {
      "type": "string",
      "format": "date-time"
    },
    "payload": {
      "type": "object",
      "maxProperties": 64,
      "additionalProperties": true
    }
  },
  "additionalProperties": false
} as const;

export type LightTickSyncOperation = {
  "operation_id": string;
  "device_id": string;
  "entity_type": "profile" | "goal" | "plan" | "task" | "task_step" | "review" | "change_proposal";
  "entity_id": string;
  "action": "create" | "update" | "start" | "complete" | "skip" | "defer" | "cancel" | "accept" | "reject" | "delete";
  "base_version": number;
  "client_occurred_at": string;
  "payload": {
  [key: string]: unknown;
};
};

export const LightTickSyncPushRequestSchema = {
  "type": "object",
  "required": [
    "operations"
  ],
  "properties": {
    "operations": {
      "type": "array",
      "minItems": 1,
      "maxItems": 50,
      "items": {
        "type": "object",
        "required": [
          "operation_id",
          "device_id",
          "entity_type",
          "entity_id",
          "action",
          "base_version",
          "client_occurred_at",
          "payload"
        ],
        "properties": {
          "operation_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "device_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "entity_type": {
            "type": "string",
            "enum": [
              "profile",
              "goal",
              "plan",
              "task",
              "task_step",
              "review",
              "change_proposal"
            ]
          },
          "entity_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "action": {
            "type": "string",
            "enum": [
              "create",
              "update",
              "start",
              "complete",
              "skip",
              "defer",
              "cancel",
              "accept",
              "reject",
              "delete"
            ]
          },
          "base_version": {
            "type": "integer",
            "minimum": 0
          },
          "client_occurred_at": {
            "type": "string",
            "format": "date-time"
          },
          "payload": {
            "type": "object",
            "maxProperties": 64,
            "additionalProperties": true
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
} as const;

export type LightTickSyncPushRequest = {
  "operations": (
{
  "operation_id": string;
  "device_id": string;
  "entity_type": "profile" | "goal" | "plan" | "task" | "task_step" | "review" | "change_proposal";
  "entity_id": string;
  "action": "create" | "update" | "start" | "complete" | "skip" | "defer" | "cancel" | "accept" | "reject" | "delete";
  "base_version": number;
  "client_occurred_at": string;
  "payload": {
  [key: string]: unknown;
};
}
)[];
};

export const LightTickSyncOperationStatusSchema = {
  "type": "string",
  "enum": [
    "accepted",
    "duplicate",
    "conflict",
    "rejected",
    "retryable"
  ]
} as const;

export type LightTickSyncOperationStatus = "accepted" | "duplicate" | "conflict" | "rejected" | "retryable";

export const LightTickSyncOperationResultSchema = {
  "type": "object",
  "required": [
    "operation_id",
    "status"
  ],
  "properties": {
    "operation_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "status": {
      "type": "string",
      "enum": [
        "accepted",
        "duplicate",
        "conflict",
        "rejected",
        "retryable"
      ]
    },
    "entity_type": {
      "type": "string",
      "enum": [
        "profile",
        "goal",
        "plan",
        "task",
        "task_step",
        "review",
        "change_proposal"
      ]
    },
    "entity_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "version": {
      "type": "integer",
      "minimum": 0
    },
    "server_snapshot": {
      "type": "object",
      "additionalProperties": true
    },
    "conflict_fields": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "resolution_actions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "error_code": {
      "type": "string",
      "enum": [
        "REQ_INVALID_BODY",
        "REQ_FIELD_REQUIRED",
        "REQ_FIELD_INVALID",
        "AUTH_REQUIRED",
        "AUTH_TOKEN_INVALID",
        "AUTH_SESSION_REVOKED",
        "APP_SCOPE_FORBIDDEN",
        "APP_MEMBER_INACTIVE",
        "LIGHTTICK_APP_DISABLED",
        "LIGHTTICK_GUEST_SESSION_EXPIRED",
        "LIGHTTICK_GUEST_UPGRADE_INVALID",
        "LIGHTTICK_GUEST_CREDENTIAL_INVALID",
        "LIGHTTICK_GUEST_EXPIRED",
        "LIGHTTICK_GUEST_REVOKED",
        "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
        "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED",
        "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED",
        "LIGHTTICK_REAUTH_REQUIRED",
        "LIGHTTICK_APP_ACCESS_DENIED",
        "LIGHTTICK_RESOURCE_NOT_FOUND",
        "LIGHTTICK_STATE_TRANSITION_INVALID",
        "LIGHTTICK_VERSION_CONFLICT",
        "LIGHTTICK_IDEMPOTENCY_MISMATCH",
        "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
        "LIGHTTICK_AI_RUN_FAILED",
        "LIGHTTICK_AI_UNAVAILABLE",
        "LIGHTTICK_AI_QUOTA_EXCEEDED",
        "LIGHTTICK_RUN_NOT_READY",
        "LIGHTTICK_PROPOSAL_STALE",
        "LIGHTTICK_PROPOSAL_NOT_PENDING",
        "LIGHTTICK_SYNC_CURSOR_INVALID",
        "LIGHTTICK_SYNC_BATCH_TOO_LARGE",
        "LIGHTTICK_SYNC_OPERATION_REJECTED",
        "LIGHTTICK_TIMEZONE_INVALID",
        "RATE_LIMITED",
        "INTERNAL_ERROR"
      ]
    }
  }
} as const;

export type LightTickSyncOperationResult = {
  "operation_id": string;
  "status": "accepted" | "duplicate" | "conflict" | "rejected" | "retryable";
  "entity_type"?: "profile" | "goal" | "plan" | "task" | "task_step" | "review" | "change_proposal";
  "entity_id"?: string;
  "version"?: number;
  "server_snapshot"?: {
  [key: string]: unknown;
};
  "conflict_fields"?: string[];
  "resolution_actions"?: string[];
  "error_code"?: "REQ_INVALID_BODY" | "REQ_FIELD_REQUIRED" | "REQ_FIELD_INVALID" | "AUTH_REQUIRED" | "AUTH_TOKEN_INVALID" | "AUTH_SESSION_REVOKED" | "APP_SCOPE_FORBIDDEN" | "APP_MEMBER_INACTIVE" | "LIGHTTICK_APP_DISABLED" | "LIGHTTICK_GUEST_SESSION_EXPIRED" | "LIGHTTICK_GUEST_UPGRADE_INVALID" | "LIGHTTICK_GUEST_CREDENTIAL_INVALID" | "LIGHTTICK_GUEST_EXPIRED" | "LIGHTTICK_GUEST_REVOKED" | "LIGHTTICK_GUEST_UPGRADE_CONFLICT" | "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED" | "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED" | "LIGHTTICK_REAUTH_REQUIRED" | "LIGHTTICK_APP_ACCESS_DENIED" | "LIGHTTICK_RESOURCE_NOT_FOUND" | "LIGHTTICK_STATE_TRANSITION_INVALID" | "LIGHTTICK_VERSION_CONFLICT" | "LIGHTTICK_IDEMPOTENCY_MISMATCH" | "LIGHTTICK_PLAN_CONSTRAINT_FAILED" | "LIGHTTICK_AI_RUN_FAILED" | "LIGHTTICK_AI_UNAVAILABLE" | "LIGHTTICK_AI_QUOTA_EXCEEDED" | "LIGHTTICK_RUN_NOT_READY" | "LIGHTTICK_PROPOSAL_STALE" | "LIGHTTICK_PROPOSAL_NOT_PENDING" | "LIGHTTICK_SYNC_CURSOR_INVALID" | "LIGHTTICK_SYNC_BATCH_TOO_LARGE" | "LIGHTTICK_SYNC_OPERATION_REJECTED" | "LIGHTTICK_TIMEZONE_INVALID" | "RATE_LIMITED" | "INTERNAL_ERROR";
};

export const LightTickSyncPushDataSchema = {
  "type": "object",
  "required": [
    "results",
    "server_time"
  ],
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "operation_id",
          "status"
        ],
        "properties": {
          "operation_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "status": {
            "type": "string",
            "enum": [
              "accepted",
              "duplicate",
              "conflict",
              "rejected",
              "retryable"
            ]
          },
          "entity_type": {
            "type": "string",
            "enum": [
              "profile",
              "goal",
              "plan",
              "task",
              "task_step",
              "review",
              "change_proposal"
            ]
          },
          "entity_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "version": {
            "type": "integer",
            "minimum": 0
          },
          "server_snapshot": {
            "type": "object",
            "additionalProperties": true
          },
          "conflict_fields": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "resolution_actions": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "error_code": {
            "type": "string",
            "enum": [
              "REQ_INVALID_BODY",
              "REQ_FIELD_REQUIRED",
              "REQ_FIELD_INVALID",
              "AUTH_REQUIRED",
              "AUTH_TOKEN_INVALID",
              "AUTH_SESSION_REVOKED",
              "APP_SCOPE_FORBIDDEN",
              "APP_MEMBER_INACTIVE",
              "LIGHTTICK_APP_DISABLED",
              "LIGHTTICK_GUEST_SESSION_EXPIRED",
              "LIGHTTICK_GUEST_UPGRADE_INVALID",
              "LIGHTTICK_GUEST_CREDENTIAL_INVALID",
              "LIGHTTICK_GUEST_EXPIRED",
              "LIGHTTICK_GUEST_REVOKED",
              "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
              "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED",
              "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED",
              "LIGHTTICK_REAUTH_REQUIRED",
              "LIGHTTICK_APP_ACCESS_DENIED",
              "LIGHTTICK_RESOURCE_NOT_FOUND",
              "LIGHTTICK_STATE_TRANSITION_INVALID",
              "LIGHTTICK_VERSION_CONFLICT",
              "LIGHTTICK_IDEMPOTENCY_MISMATCH",
              "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
              "LIGHTTICK_AI_RUN_FAILED",
              "LIGHTTICK_AI_UNAVAILABLE",
              "LIGHTTICK_AI_QUOTA_EXCEEDED",
              "LIGHTTICK_RUN_NOT_READY",
              "LIGHTTICK_PROPOSAL_STALE",
              "LIGHTTICK_PROPOSAL_NOT_PENDING",
              "LIGHTTICK_SYNC_CURSOR_INVALID",
              "LIGHTTICK_SYNC_BATCH_TOO_LARGE",
              "LIGHTTICK_SYNC_OPERATION_REJECTED",
              "LIGHTTICK_TIMEZONE_INVALID",
              "RATE_LIMITED",
              "INTERNAL_ERROR"
            ]
          }
        }
      }
    },
    "server_time": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickSyncPushData = {
  "results": (
{
  "operation_id": string;
  "status": "accepted" | "duplicate" | "conflict" | "rejected" | "retryable";
  "entity_type"?: "profile" | "goal" | "plan" | "task" | "task_step" | "review" | "change_proposal";
  "entity_id"?: string;
  "version"?: number;
  "server_snapshot"?: {
  [key: string]: unknown;
};
  "conflict_fields"?: string[];
  "resolution_actions"?: string[];
  "error_code"?: "REQ_INVALID_BODY" | "REQ_FIELD_REQUIRED" | "REQ_FIELD_INVALID" | "AUTH_REQUIRED" | "AUTH_TOKEN_INVALID" | "AUTH_SESSION_REVOKED" | "APP_SCOPE_FORBIDDEN" | "APP_MEMBER_INACTIVE" | "LIGHTTICK_APP_DISABLED" | "LIGHTTICK_GUEST_SESSION_EXPIRED" | "LIGHTTICK_GUEST_UPGRADE_INVALID" | "LIGHTTICK_GUEST_CREDENTIAL_INVALID" | "LIGHTTICK_GUEST_EXPIRED" | "LIGHTTICK_GUEST_REVOKED" | "LIGHTTICK_GUEST_UPGRADE_CONFLICT" | "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED" | "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED" | "LIGHTTICK_REAUTH_REQUIRED" | "LIGHTTICK_APP_ACCESS_DENIED" | "LIGHTTICK_RESOURCE_NOT_FOUND" | "LIGHTTICK_STATE_TRANSITION_INVALID" | "LIGHTTICK_VERSION_CONFLICT" | "LIGHTTICK_IDEMPOTENCY_MISMATCH" | "LIGHTTICK_PLAN_CONSTRAINT_FAILED" | "LIGHTTICK_AI_RUN_FAILED" | "LIGHTTICK_AI_UNAVAILABLE" | "LIGHTTICK_AI_QUOTA_EXCEEDED" | "LIGHTTICK_RUN_NOT_READY" | "LIGHTTICK_PROPOSAL_STALE" | "LIGHTTICK_PROPOSAL_NOT_PENDING" | "LIGHTTICK_SYNC_CURSOR_INVALID" | "LIGHTTICK_SYNC_BATCH_TOO_LARGE" | "LIGHTTICK_SYNC_OPERATION_REJECTED" | "LIGHTTICK_TIMEZONE_INVALID" | "RATE_LIMITED" | "INTERNAL_ERROR";
}
)[];
  "server_time": string;
};

export const LightTickSyncChangeSchema = {
  "type": "object",
  "required": [
    "sequence",
    "entity_type",
    "entity_id",
    "version",
    "operation",
    "changed_at"
  ],
  "properties": {
    "sequence": {
      "type": "integer",
      "minimum": 1
    },
    "entity_type": {
      "type": "string",
      "enum": [
        "profile",
        "goal",
        "plan",
        "task",
        "task_step",
        "review",
        "change_proposal"
      ]
    },
    "entity_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "version": {
      "type": "integer",
      "minimum": 1
    },
    "operation": {
      "enum": [
        "upsert",
        "delete"
      ]
    },
    "snapshot": {
      "type": "object",
      "additionalProperties": true
    },
    "changed_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickSyncChange = {
  "sequence": number;
  "entity_type": "profile" | "goal" | "plan" | "task" | "task_step" | "review" | "change_proposal";
  "entity_id": string;
  "version": number;
  "operation": "upsert" | "delete";
  "snapshot"?: {
  [key: string]: unknown;
};
  "changed_at": string;
};

export const LightTickSyncPullDataSchema = {
  "type": "object",
  "required": [
    "changes",
    "next_cursor",
    "has_more",
    "server_time"
  ],
  "properties": {
    "changes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "sequence",
          "entity_type",
          "entity_id",
          "version",
          "operation",
          "changed_at"
        ],
        "properties": {
          "sequence": {
            "type": "integer",
            "minimum": 1
          },
          "entity_type": {
            "type": "string",
            "enum": [
              "profile",
              "goal",
              "plan",
              "task",
              "task_step",
              "review",
              "change_proposal"
            ]
          },
          "entity_id": {
            "type": "string",
            "minLength": 8,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
          },
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "operation": {
            "enum": [
              "upsert",
              "delete"
            ]
          },
          "snapshot": {
            "type": "object",
            "additionalProperties": true
          },
          "changed_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    },
    "next_cursor": {
      "type": "string"
    },
    "has_more": {
      "type": "boolean"
    },
    "server_time": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickSyncPullData = {
  "changes": (
{
  "sequence": number;
  "entity_type": "profile" | "goal" | "plan" | "task" | "task_step" | "review" | "change_proposal";
  "entity_id": string;
  "version": number;
  "operation": "upsert" | "delete";
  "snapshot"?: {
  [key: string]: unknown;
};
  "changed_at": string;
}
)[];
  "next_cursor": string;
  "has_more": boolean;
  "server_time": string;
};

export const LightTickDevicePlatformSchema = {
  "type": "string",
  "enum": [
    "ios",
    "android"
  ]
} as const;

export type LightTickDevicePlatform = "ios" | "android";

export const LightTickPushProviderSchema = {
  "type": "string",
  "enum": [
    "apns",
    "fcm"
  ]
} as const;

export type LightTickPushProvider = "apns" | "fcm";

export const LightTickDeviceUpsertRequestSchema = {
  "type": "object",
  "required": [
    "device_id",
    "platform",
    "push_provider",
    "push_token",
    "timezone",
    "locale",
    "app_version"
  ],
  "properties": {
    "device_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "platform": {
      "type": "string",
      "enum": [
        "ios",
        "android"
      ]
    },
    "push_provider": {
      "type": "string",
      "enum": [
        "apns",
        "fcm"
      ]
    },
    "push_token": {
      "type": "string",
      "minLength": 16,
      "maxLength": 4096
    },
    "timezone": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "IANA timezone identifier such as Asia/Shanghai."
    },
    "locale": {
      "type": "string",
      "minLength": 2,
      "maxLength": 16
    },
    "app_version": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "notifications_enabled": {
      "type": "boolean",
      "default": true
    }
  },
  "additionalProperties": false
} as const;

export type LightTickDeviceUpsertRequest = {
  "device_id": string;
  "platform": "ios" | "android";
  "push_provider": "apns" | "fcm";
  "push_token": string;
  "timezone": string;
  "locale": string;
  "app_version": string;
  "notifications_enabled"?: boolean;
};

export const LightTickDeviceDataSchema = {
  "type": "object",
  "required": [
    "id",
    "platform",
    "push_provider",
    "timezone",
    "locale",
    "app_version",
    "active",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "platform": {
      "type": "string",
      "enum": [
        "ios",
        "android"
      ]
    },
    "push_provider": {
      "type": "string",
      "enum": [
        "apns",
        "fcm"
      ]
    },
    "timezone": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "IANA timezone identifier such as Asia/Shanghai."
    },
    "locale": {
      "type": "string"
    },
    "app_version": {
      "type": "string"
    },
    "active": {
      "type": "boolean"
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    }
  }
} as const;

export type LightTickDeviceData = {
  "id": string;
  "platform": "ios" | "android";
  "push_provider": "apns" | "fcm";
  "timezone": string;
  "locale": string;
  "app_version": string;
  "active": boolean;
  "created_at": string;
  "updated_at": string;
};

export const LightTickRuntimeEnvironmentSchema = {
  "type": "string",
  "enum": [
    "local",
    "dev",
    "online"
  ]
} as const;

export type LightTickRuntimeEnvironment = "local" | "dev" | "online";

export const LightTickAccountKindSchema = {
  "type": "string",
  "enum": [
    "guest",
    "registered"
  ]
} as const;

export type LightTickAccountKind = "guest" | "registered";

export const LightTickPublicFeatureFlagsSchema = {
  "type": "object",
  "required": [
    "guest_sessions",
    "account_upgrade",
    "sync",
    "notifications",
    "ai_coach"
  ],
  "properties": {
    "guest_sessions": {
      "type": "boolean"
    },
    "account_upgrade": {
      "type": "boolean"
    },
    "sync": {
      "type": "boolean"
    },
    "notifications": {
      "type": "boolean"
    },
    "ai_coach": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
} as const;

export type LightTickPublicFeatureFlags = {
  "guest_sessions": boolean;
  "account_upgrade": boolean;
  "sync": boolean;
  "notifications": boolean;
  "ai_coach": boolean;
};

export const LightTickMinimumClientVersionsSchema = {
  "type": "object",
  "required": [
    "ios",
    "android"
  ],
  "properties": {
    "ios": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "android": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    }
  },
  "additionalProperties": false
} as const;

export type LightTickMinimumClientVersions = {
  "ios": string;
  "android": string;
};

export const LightTickPublicConfigDataSchema = {
  "type": "object",
  "required": [
    "app_id",
    "enabled",
    "environment",
    "configuration_version",
    "minimum_client_versions",
    "guest_session_ttl_seconds",
    "features",
    "privacy_policy_url",
    "terms_of_service_url",
    "support_url",
    "updated_at"
  ],
  "properties": {
    "app_id": {
      "type": "string",
      "const": "lighttick"
    },
    "enabled": {
      "type": "boolean"
    },
    "environment": {
      "type": "string",
      "enum": [
        "local",
        "dev",
        "online"
      ]
    },
    "configuration_version": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "minimum_client_versions": {
      "type": "object",
      "required": [
        "ios",
        "android"
      ],
      "properties": {
        "ios": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "android": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      },
      "additionalProperties": false
    },
    "guest_session_ttl_seconds": {
      "type": "integer",
      "minimum": 3600,
      "maximum": 7776000
    },
    "features": {
      "type": "object",
      "required": [
        "guest_sessions",
        "account_upgrade",
        "sync",
        "notifications",
        "ai_coach"
      ],
      "properties": {
        "guest_sessions": {
          "type": "boolean"
        },
        "account_upgrade": {
          "type": "boolean"
        },
        "sync": {
          "type": "boolean"
        },
        "notifications": {
          "type": "boolean"
        },
        "ai_coach": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    },
    "privacy_policy_url": {
      "type": "string",
      "format": "uri"
    },
    "terms_of_service_url": {
      "type": "string",
      "format": "uri"
    },
    "support_url": {
      "type": "string",
      "format": "uri"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    }
  },
  "additionalProperties": false
} as const;

export type LightTickPublicConfigData = {
  "app_id": string;
  "enabled": boolean;
  "environment": "local" | "dev" | "online";
  "configuration_version": string;
  "minimum_client_versions": {
  "ios": string;
  "android": string;
};
  "guest_session_ttl_seconds": number;
  "features": {
  "guest_sessions": boolean;
  "account_upgrade": boolean;
  "sync": boolean;
  "notifications": boolean;
  "ai_coach": boolean;
};
  "privacy_policy_url": string;
  "terms_of_service_url": string;
  "support_url": string;
  "updated_at": string;
};

export const LightTickPublicConfigEnvelopeSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data",
    "requestId"
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
        "app_id",
        "enabled",
        "environment",
        "configuration_version",
        "minimum_client_versions",
        "guest_session_ttl_seconds",
        "features",
        "privacy_policy_url",
        "terms_of_service_url",
        "support_url",
        "updated_at"
      ],
      "properties": {
        "app_id": {
          "type": "string",
          "const": "lighttick"
        },
        "enabled": {
          "type": "boolean"
        },
        "environment": {
          "type": "string",
          "enum": [
            "local",
            "dev",
            "online"
          ]
        },
        "configuration_version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "minimum_client_versions": {
          "type": "object",
          "required": [
            "ios",
            "android"
          ],
          "properties": {
            "ios": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "android": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            }
          },
          "additionalProperties": false
        },
        "guest_session_ttl_seconds": {
          "type": "integer",
          "minimum": 3600,
          "maximum": 7776000
        },
        "features": {
          "type": "object",
          "required": [
            "guest_sessions",
            "account_upgrade",
            "sync",
            "notifications",
            "ai_coach"
          ],
          "properties": {
            "guest_sessions": {
              "type": "boolean"
            },
            "account_upgrade": {
              "type": "boolean"
            },
            "sync": {
              "type": "boolean"
            },
            "notifications": {
              "type": "boolean"
            },
            "ai_coach": {
              "type": "boolean"
            }
          },
          "additionalProperties": false
        },
        "privacy_policy_url": {
          "type": "string",
          "format": "uri"
        },
        "terms_of_service_url": {
          "type": "string",
          "format": "uri"
        },
        "support_url": {
          "type": "string",
          "format": "uri"
        },
        "updated_at": {
          "type": "string",
          "format": "date-time"
        }
      },
      "additionalProperties": false
    },
    "requestId": {
      "type": "string"
    }
  }
} as const;

export type LightTickPublicConfigEnvelope = {
  "code": string;
  "message": string;
  "data": {
  "app_id": string;
  "enabled": boolean;
  "environment": "local" | "dev" | "online";
  "configuration_version": string;
  "minimum_client_versions": {
  "ios": string;
  "android": string;
};
  "guest_session_ttl_seconds": number;
  "features": {
  "guest_sessions": boolean;
  "account_upgrade": boolean;
  "sync": boolean;
  "notifications": boolean;
  "ai_coach": boolean;
};
  "privacy_policy_url": string;
  "terms_of_service_url": string;
  "support_url": string;
  "updated_at": string;
};
  "requestId": string;
};

export const LightTickGuestSessionRequestSchema = {
  "type": "object",
  "required": [
    "device_id",
    "device_secret",
    "platform",
    "timezone",
    "locale",
    "app_version"
  ],
  "properties": {
    "device_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "device_secret": {
      "type": "string",
      "minLength": 32,
      "maxLength": 4096,
      "description": "Device-generated secret stored in Keychain or Keystore and never logged by the server."
    },
    "platform": {
      "type": "string",
      "enum": [
        "ios",
        "android"
      ]
    },
    "timezone": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "description": "IANA timezone identifier such as Asia/Shanghai."
    },
    "locale": {
      "type": "string",
      "minLength": 2,
      "maxLength": 16
    },
    "app_version": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    }
  },
  "additionalProperties": false
} as const;

export type LightTickGuestSessionRequest = {
  "device_id": string;
  "device_secret": string;
  "platform": "ios" | "android";
  "timezone": string;
  "locale": string;
  "app_version": string;
};

export const LightTickGuestSessionDataSchema = {
  "type": "object",
  "required": [
    "account_kind",
    "user_id",
    "device_id",
    "access_token",
    "refresh_token",
    "expires_in",
    "guest_expires_at",
    "upgrade_token"
  ],
  "properties": {
    "account_kind": {
      "type": "string",
      "const": "guest"
    },
    "user_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "device_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "access_token": {
      "type": "string",
      "minLength": 16
    },
    "refresh_token": {
      "type": "string",
      "minLength": 16
    },
    "expires_in": {
      "type": "integer",
      "minimum": 1
    },
    "guest_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "upgrade_token": {
      "type": "string",
      "minLength": 32
    }
  }
} as const;

export type LightTickGuestSessionData = {
  "account_kind": string;
  "user_id": string;
  "device_id": string;
  "access_token": string;
  "refresh_token": string;
  "expires_in": number;
  "guest_expires_at": string;
  "upgrade_token": string;
};

export const LightTickGuestSessionEnvelopeSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data",
    "requestId"
  ],
  "properties": {
    "code": {
      "type": "string",
      "example": "CREATED"
    },
    "message": {
      "type": "string",
      "example": "created"
    },
    "data": {
      "type": "object",
      "required": [
        "account_kind",
        "user_id",
        "device_id",
        "access_token",
        "refresh_token",
        "expires_in",
        "guest_expires_at",
        "upgrade_token"
      ],
      "properties": {
        "account_kind": {
          "type": "string",
          "const": "guest"
        },
        "user_id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "device_id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "access_token": {
          "type": "string",
          "minLength": 16
        },
        "refresh_token": {
          "type": "string",
          "minLength": 16
        },
        "expires_in": {
          "type": "integer",
          "minimum": 1
        },
        "guest_expires_at": {
          "type": "string",
          "format": "date-time"
        },
        "upgrade_token": {
          "type": "string",
          "minLength": 32
        }
      }
    },
    "requestId": {
      "type": "string"
    }
  }
} as const;

export type LightTickGuestSessionEnvelope = {
  "code": string;
  "message": string;
  "data": {
  "account_kind": string;
  "user_id": string;
  "device_id": string;
  "access_token": string;
  "refresh_token": string;
  "expires_in": number;
  "guest_expires_at": string;
  "upgrade_token": string;
};
  "requestId": string;
};

export const LightTickAccountSessionDataSchema = {
  "type": "object",
  "required": [
    "app_id",
    "account_kind",
    "user_id",
    "membership_status",
    "session_expires_at"
  ],
  "properties": {
    "app_id": {
      "type": "string",
      "const": "lighttick"
    },
    "account_kind": {
      "type": "string",
      "enum": [
        "guest",
        "registered"
      ]
    },
    "user_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "membership_status": {
      "type": "string",
      "enum": [
        "ACTIVE"
      ]
    },
    "session_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "guest_expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "sync_cursor": {
      "type": "string",
      "maxLength": 512
    }
  }
} as const;

export type LightTickAccountSessionData = {
  "app_id": string;
  "account_kind": "guest" | "registered";
  "user_id": string;
  "membership_status": "ACTIVE";
  "session_expires_at": string;
  "guest_expires_at"?: string;
  "sync_cursor"?: string;
};

export const LightTickAccountSessionEnvelopeSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data",
    "requestId"
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
        "app_id",
        "account_kind",
        "user_id",
        "membership_status",
        "session_expires_at"
      ],
      "properties": {
        "app_id": {
          "type": "string",
          "const": "lighttick"
        },
        "account_kind": {
          "type": "string",
          "enum": [
            "guest",
            "registered"
          ]
        },
        "user_id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "membership_status": {
          "type": "string",
          "enum": [
            "ACTIVE"
          ]
        },
        "session_expires_at": {
          "type": "string",
          "format": "date-time"
        },
        "guest_expires_at": {
          "type": "string",
          "format": "date-time"
        },
        "sync_cursor": {
          "type": "string",
          "maxLength": 512
        }
      }
    },
    "requestId": {
      "type": "string"
    }
  }
} as const;

export type LightTickAccountSessionEnvelope = {
  "code": string;
  "message": string;
  "data": {
  "app_id": string;
  "account_kind": "guest" | "registered";
  "user_id": string;
  "membership_status": "ACTIVE";
  "session_expires_at": string;
  "guest_expires_at"?: string;
  "sync_cursor"?: string;
};
  "requestId": string;
};

export const LightTickAccountUpgradeRequestSchema = {
  "type": "object",
  "required": [
    "guest_user_id",
    "guest_upgrade_token",
    "device_id"
  ],
  "properties": {
    "guest_user_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "guest_upgrade_token": {
      "type": "string",
      "minLength": 32,
      "maxLength": 4096
    },
    "device_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    }
  },
  "additionalProperties": false
} as const;

export type LightTickAccountUpgradeRequest = {
  "guest_user_id": string;
  "guest_upgrade_token": string;
  "device_id": string;
};

export const LightTickTransferredResourceCountsSchema = {
  "type": "object",
  "required": [
    "goals",
    "plans",
    "tasks",
    "reviews",
    "proposals"
  ],
  "properties": {
    "goals": {
      "type": "integer",
      "minimum": 0
    },
    "plans": {
      "type": "integer",
      "minimum": 0
    },
    "tasks": {
      "type": "integer",
      "minimum": 0
    },
    "reviews": {
      "type": "integer",
      "minimum": 0
    },
    "proposals": {
      "type": "integer",
      "minimum": 0
    }
  },
  "additionalProperties": false
} as const;

export type LightTickTransferredResourceCounts = {
  "goals": number;
  "plans": number;
  "tasks": number;
  "reviews": number;
  "proposals": number;
};

export const LightTickAccountUpgradeDataSchema = {
  "type": "object",
  "required": [
    "account_kind",
    "user_id",
    "previous_guest_user_id",
    "guest_session_revoked",
    "idempotency_replayed",
    "transferred_resource_counts"
  ],
  "properties": {
    "account_kind": {
      "type": "string",
      "const": "registered"
    },
    "user_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "previous_guest_user_id": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
    },
    "guest_session_revoked": {
      "type": "boolean",
      "const": true
    },
    "idempotency_replayed": {
      "type": "boolean"
    },
    "sync_cursor": {
      "type": "string",
      "maxLength": 512
    },
    "transferred_resource_counts": {
      "type": "object",
      "required": [
        "goals",
        "plans",
        "tasks",
        "reviews",
        "proposals"
      ],
      "properties": {
        "goals": {
          "type": "integer",
          "minimum": 0
        },
        "plans": {
          "type": "integer",
          "minimum": 0
        },
        "tasks": {
          "type": "integer",
          "minimum": 0
        },
        "reviews": {
          "type": "integer",
          "minimum": 0
        },
        "proposals": {
          "type": "integer",
          "minimum": 0
        }
      },
      "additionalProperties": false
    }
  }
} as const;

export type LightTickAccountUpgradeData = {
  "account_kind": string;
  "user_id": string;
  "previous_guest_user_id": string;
  "guest_session_revoked": boolean;
  "idempotency_replayed": boolean;
  "sync_cursor"?: string;
  "transferred_resource_counts": {
  "goals": number;
  "plans": number;
  "tasks": number;
  "reviews": number;
  "proposals": number;
};
};

export const LightTickAccountUpgradeEnvelopeSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data",
    "requestId"
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
        "account_kind",
        "user_id",
        "previous_guest_user_id",
        "guest_session_revoked",
        "idempotency_replayed",
        "transferred_resource_counts"
      ],
      "properties": {
        "account_kind": {
          "type": "string",
          "const": "registered"
        },
        "user_id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "previous_guest_user_id": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]+$"
        },
        "guest_session_revoked": {
          "type": "boolean",
          "const": true
        },
        "idempotency_replayed": {
          "type": "boolean"
        },
        "sync_cursor": {
          "type": "string",
          "maxLength": 512
        },
        "transferred_resource_counts": {
          "type": "object",
          "required": [
            "goals",
            "plans",
            "tasks",
            "reviews",
            "proposals"
          ],
          "properties": {
            "goals": {
              "type": "integer",
              "minimum": 0
            },
            "plans": {
              "type": "integer",
              "minimum": 0
            },
            "tasks": {
              "type": "integer",
              "minimum": 0
            },
            "reviews": {
              "type": "integer",
              "minimum": 0
            },
            "proposals": {
              "type": "integer",
              "minimum": 0
            }
          },
          "additionalProperties": false
        }
      }
    },
    "requestId": {
      "type": "string"
    }
  }
} as const;

export type LightTickAccountUpgradeEnvelope = {
  "code": string;
  "message": string;
  "data": {
  "account_kind": string;
  "user_id": string;
  "previous_guest_user_id": string;
  "guest_session_revoked": boolean;
  "idempotency_replayed": boolean;
  "sync_cursor"?: string;
  "transferred_resource_counts": {
  "goals": number;
  "plans": number;
  "tasks": number;
  "reviews": number;
  "proposals": number;
};
};
  "requestId": string;
};

export const LightTickAccountDeletionRequestSchema = {
  "type": "object",
  "required": [
    "confirmation",
    "reauthentication_token"
  ],
  "properties": {
    "confirmation": {
      "type": "string",
      "const": "DELETE"
    },
    "reauthentication_token": {
      "type": "string",
      "minLength": 16,
      "maxLength": 4096,
      "description": "Opaque, short-lived one-time proof issued after recent common-auth reauthentication."
    }
  },
  "additionalProperties": false
} as const;

export type LightTickAccountDeletionRequest = {
  "confirmation": string;
  "reauthentication_token": string;
};

export const LightTickAccountDeletionDataSchema = {
  "type": "object",
  "required": [
    "app_id",
    "membership_status",
    "sessions_revoked",
    "product_data_deleted",
    "platform_account_retained",
    "other_memberships_retained"
  ],
  "properties": {
    "app_id": {
      "type": "string",
      "const": "lighttick"
    },
    "membership_status": {
      "type": "string",
      "const": "DELETED"
    },
    "sessions_revoked": {
      "type": "boolean"
    },
    "product_data_deleted": {
      "type": "boolean"
    },
    "platform_account_retained": {
      "type": "boolean",
      "const": true
    },
    "other_memberships_retained": {
      "type": "boolean",
      "const": true
    }
  }
} as const;

export type LightTickAccountDeletionData = {
  "app_id": string;
  "membership_status": string;
  "sessions_revoked": boolean;
  "product_data_deleted": boolean;
  "platform_account_retained": boolean;
  "other_memberships_retained": boolean;
};

export const LightTickAccountDeletionEnvelopeSchema = {
  "type": "object",
  "required": [
    "code",
    "message",
    "data",
    "requestId"
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
        "app_id",
        "membership_status",
        "sessions_revoked",
        "product_data_deleted",
        "platform_account_retained",
        "other_memberships_retained"
      ],
      "properties": {
        "app_id": {
          "type": "string",
          "const": "lighttick"
        },
        "membership_status": {
          "type": "string",
          "const": "DELETED"
        },
        "sessions_revoked": {
          "type": "boolean"
        },
        "product_data_deleted": {
          "type": "boolean"
        },
        "platform_account_retained": {
          "type": "boolean",
          "const": true
        },
        "other_memberships_retained": {
          "type": "boolean",
          "const": true
        }
      }
    },
    "requestId": {
      "type": "string"
    }
  }
} as const;

export type LightTickAccountDeletionEnvelope = {
  "code": string;
  "message": string;
  "data": {
  "app_id": string;
  "membership_status": string;
  "sessions_revoked": boolean;
  "product_data_deleted": boolean;
  "platform_account_retained": boolean;
  "other_memberships_retained": boolean;
};
  "requestId": string;
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
  "LightTickAccountDeletionData",
  "LightTickAccountDeletionEnvelope",
  "LightTickAccountDeletionRequest",
  "LightTickAccountKind",
  "LightTickAccountSessionData",
  "LightTickAccountSessionEnvelope",
  "LightTickAccountUpgradeData",
  "LightTickAccountUpgradeEnvelope",
  "LightTickAccountUpgradeRequest",
  "LightTickAvailabilityWindow",
  "LightTickChangeProposalData",
  "LightTickChangeProposalRunRequest",
  "LightTickCommitmentMode",
  "LightTickCommitmentRequest",
  "LightTickConstraintViolation",
  "LightTickDeviceData",
  "LightTickDevicePlatform",
  "LightTickDeviceUpsertRequest",
  "LightTickEnvelope",
  "LightTickErrorCode",
  "LightTickErrorData",
  "LightTickErrorEnvelope",
  "LightTickFirstActionRequest",
  "LightTickGoalConstraints",
  "LightTickGoalCreateRequest",
  "LightTickGoalData",
  "LightTickGoalLifecycleRequest",
  "LightTickGoalStatus",
  "LightTickGoalUpdateRequest",
  "LightTickGuestSessionData",
  "LightTickGuestSessionEnvelope",
  "LightTickGuestSessionRequest",
  "LightTickId",
  "LightTickMinimumClientVersions",
  "LightTickNotificationPreferences",
  "LightTickOnboardingRequest",
  "LightTickPace",
  "LightTickPlanData",
  "LightTickPlanDiffItem",
  "LightTickPlanGranularity",
  "LightTickPlanRunRequest",
  "LightTickPlanStatus",
  "LightTickProfileData",
  "LightTickProfileUpdateRequest",
  "LightTickProposalImpact",
  "LightTickProposalRejectRequest",
  "LightTickProposalStatus",
  "LightTickPublicConfigData",
  "LightTickPublicConfigEnvelope",
  "LightTickPublicFeatureFlags",
  "LightTickPushProvider",
  "LightTickReviewData",
  "LightTickReviewPeriod",
  "LightTickReviewRunRequest",
  "LightTickReviewStatus",
  "LightTickRunData",
  "LightTickRunEnvelope",
  "LightTickRunKind",
  "LightTickRunStatus",
  "LightTickRuntimeEnvironment",
  "LightTickSkipReason",
  "LightTickStarterCandidate",
  "LightTickStarterRequest",
  "LightTickSyncAction",
  "LightTickSyncChange",
  "LightTickSyncEntityType",
  "LightTickSyncOperation",
  "LightTickSyncOperationResult",
  "LightTickSyncOperationStatus",
  "LightTickSyncPullData",
  "LightTickSyncPushData",
  "LightTickSyncPushRequest",
  "LightTickTaskCompleteRequest",
  "LightTickTaskData",
  "LightTickTaskDeferRequest",
  "LightTickTaskDifficulty",
  "LightTickTaskSkipRequest",
  "LightTickTaskStatus",
  "LightTickTaskStepData",
  "LightTickTaskVariant",
  "LightTickTaskVariantDefinition",
  "LightTickTaskVariantRequest",
  "LightTickTimestamp",
  "LightTickTimezone",
  "LightTickTodayData",
  "LightTickTransferredResourceCounts",
  "LightTickVersion",
  "LightTickVersionedCommandRequest",
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
