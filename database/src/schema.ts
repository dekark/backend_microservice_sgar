import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const authProviderEnum = pgEnum(
  'auth_provider',
  ['GOOGLE'],
);

export const resourceTypeEnum = pgEnum(
  'resource_type',
  [
    'DOCUMENT',
    'FILE',
    'LINK',
    'IMAGE',
    'VIDEO',
    'SOFTWARE',
    'LICENSE',
    'EQUIPMENT',
    'OTHER',
  ],
);

export const resourceStatusEnum = pgEnum(
  'resource_status',
  [
    'ACTIVE',
    'INACTIVE',
    'ARCHIVED',
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: integer('id')
      .primaryKey()
      .generatedAlwaysAsIdentity(),

    name: varchar('name', {
      length: 100,
    }).notNull(),

    description: text('description'),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('roles_name_unique_idx')
      .on(table.name),

    index('roles_active_idx')
      .on(table.isActive),
  ],
);

export const permissions = pgTable(
  'permissions',
  {
    id: integer('id')
      .primaryKey()
      .generatedAlwaysAsIdentity(),

    key: varchar('key', {
      length: 150,
    }).notNull(),

    name: varchar('name', {
      length: 150,
    }).notNull(),

    description: text('description'),

    module: varchar('module', {
      length: 100,
    }).notNull(),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('permissions_key_unique_idx')
      .on(table.key),

    index('permissions_module_idx')
      .on(table.module),

    index('permissions_active_idx')
      .on(table.isActive),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(
        () => roles.id,
        {
          onDelete: 'cascade',
        },
      ),

    permissionId: integer('permission_id')
      .notNull()
      .references(
        () => permissions.id,
        {
          onDelete: 'cascade',
        },
      ),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.roleId,
        table.permissionId,
      ],
    }),

    index('role_permissions_role_idx')
      .on(table.roleId),

    index('role_permissions_permission_idx')
      .on(table.permissionId),
  ],
);

export const areas = pgTable(
  'areas',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    name: varchar('name', {
      length: 150,
    }).notNull(),

    description: text('description'),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('areas_name_unique_idx')
      .on(table.name),

    index('areas_active_idx')
      .on(table.isActive),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    googleSub: varchar('google_sub', {
      length: 255,
    }).notNull(),

    email: varchar('email', {
      length: 255,
    }).notNull(),

    name: varchar('name', {
      length: 150,
    }).notNull(),

    authProvider: authProviderEnum(
      'auth_provider',
    )
      .default('GOOGLE')
      .notNull(),

    avatarS3Bucket: varchar(
      'avatar_s3_bucket',
      {
        length: 255,
      },
    ),

    avatarS3Key: text(
      'avatar_s3_key',
    ),

    avatarMimeType: varchar(
      'avatar_mime_type',
      {
        length: 100,
      },
    ),

    avatarFileSize: bigint(
      'avatar_file_size',
      {
        mode: 'number',
      },
    ),

    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id),

    areaId: uuid('area_id')
      .references(
        () => areas.id,
        {
          onDelete: 'set null',
        },
      ),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),

    lastLoginAt: timestamp(
      'last_login_at',
      {
        withTimezone: true,
      },
    ),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('users_google_sub_unique_idx')
      .on(table.googleSub),

    uniqueIndex('users_email_unique_idx')
      .on(table.email),

    index('users_role_idx')
      .on(table.roleId),

    index('users_area_idx')
      .on(table.areaId),

    index('users_active_idx')
      .on(table.isActive),
  ],
);

export const resources = pgTable(
  'resources',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    areaId: uuid('area_id')
      .notNull()
      .references(() => areas.id),

    name: varchar('name', {
      length: 200,
    }).notNull(),

    description: text('description'),

    type: resourceTypeEnum('type')
      .notNull(),

    status: resourceStatusEnum('status')
      .default('ACTIVE')
      .notNull(),

    url: text('url'),

    s3Bucket: varchar('s3_bucket', {
      length: 255,
    }),

    s3Key: text('s3_key'),

    originalFileName: text(
      'original_file_name',
    ),

    mimeType: varchar('mime_type', {
      length: 150,
    }),

    fileSize: bigint('file_size', {
      mode: 'number',
    }),

    imageS3Bucket: varchar('image_s3_bucket', { length: 255 }),
    imageS3Key: text('image_s3_key'),
    imageMimeType: varchar('image_mime_type', { length: 100 }),
    imageFileSize: bigint('image_file_size', { mode: 'number' }),

    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('resources_area_idx')
      .on(table.areaId),

    index('resources_created_by_idx')
      .on(table.createdById),

    index('resources_status_idx')
      .on(table.status),

    index('resources_type_idx')
      .on(table.type),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(
        () => users.id,
        {
          onDelete: 'cascade',
        },
      ),

    tokenHash: text('token_hash')
      .notNull(),

    // Nullable only for legacy tokens, which auth-service rejects.
    sessionId: uuid('session_id').references(() => userSessions.id, {
      onDelete: 'cascade',
    }),

    expiresAt: timestamp('expires_at', {
      withTimezone: true,
    }).notNull(),

    revokedAt: timestamp('revoked_at', {
      withTimezone: true,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('refresh_tokens_user_idx')
      .on(table.userId),

    index('refresh_tokens_expires_idx')
      .on(table.expiresAt),

    index('refresh_tokens_session_idx').on(table.sessionId),
  ],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(
        () => users.id,
        {
          onDelete: 'cascade',
        },
      ),

    ipAddress: varchar('ip_address', {
      length: 100,
    }),

    userAgent: text('user_agent'),

    // Existing sessions expire on migration; new sessions set an explicit TTL.
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .defaultNow()
      .notNull(),

    isActive: boolean('is_active')
      .default(true)
      .notNull(),

    lastActiveAt: timestamp(
      'last_active_at',
      {
        withTimezone: true,
      },
    )
      .defaultNow()
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('user_sessions_user_idx')
      .on(table.userId),

    index('user_sessions_active_idx')
      .on(table.isActive),

    index('user_sessions_last_active_idx')
      .on(table.lastActiveAt),

    index('user_sessions_expires_idx').on(table.expiresAt),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    userId: uuid('user_id')
      .references(
        () => users.id,
        {
          onDelete: 'set null',
        },
      ),

    action: varchar('action', {
      length: 150,
    }).notNull(),

    entity: varchar('entity', {
      length: 100,
    }).notNull(),

    entityId: varchar('entity_id', {
      length: 255,
    }),

    areaId: uuid('area_id')
      .references(
        () => areas.id,
        {
          onDelete: 'set null',
        },
      ),

    metadata: jsonb('metadata'),

    ipAddress: varchar('ip_address', {
      length: 100,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('audit_logs_user_idx')
      .on(table.userId),

    index('audit_logs_area_idx')
      .on(table.areaId),

    index('audit_logs_action_idx')
      .on(table.action),

    index('audit_logs_entity_idx')
      .on(table.entity),

    index('audit_logs_created_at_idx')
      .on(table.createdAt),
  ],
);

export interface AuthEvent {
  eventId: string;
  version: 1;
  source: 'auth-service';
  action: string;
  occurredAt: string;
  userId: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  reason?: string;
}

export const brokerCommands = pgTable('broker_commands', {
  service: varchar('service', { length: 30 }).notNull(),
  requestId: uuid('request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  state: varchar('state', { length: 20 }).default('started').notNull(),
  statusCode: integer('status_code'),
  auditRequestId: uuid('audit_request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, table => [primaryKey({ columns: [table.service, table.requestId] })]);

export const applicationOutbox = pgTable('application_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id').notNull(),
  source: varchar('source', { length: 50 }).notNull(),
  destination: varchar('destination', { length: 10 }).$type<'kafka' | 'rabbit'>().notNull(),
  payload: jsonb('payload').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  claimedBy: uuid('claimed_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex('application_outbox_event_destination_idx').on(table.eventId, table.destination),
  index('application_outbox_pending_idx').on(table.source, table.publishedAt, table.availableAt),
]);

// Separate from editable audit logs: retries cannot recreate deleted records.
export const auditEventReceipts = pgTable('audit_event_receipts', {
  eventId: uuid('event_id').primaryKey(),
  eventHash: varchar('event_hash', { length: 64 }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
});

// Each event has independent deliveries to Kafka and the RabbitMQ audit queue.
export const authOutbox = pgTable('auth_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id').notNull(),
  destination: varchar('destination', { length: 10 }).$type<'kafka' | 'rabbit'>().notNull(),
  payload: jsonb('payload').$type<AuthEvent>().notNull(),
  attempts: integer('attempts').default(0).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  claimedBy: uuid('claimed_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('auth_outbox_event_destination_idx').on(table.eventId, table.destination),
  index('auth_outbox_pending_idx').on(table.publishedAt, table.availableAt),
]);
