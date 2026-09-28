interface ConfigReader {
  get<T>(key: string): T | undefined;
}
export function applicationMessagingConfig(config: ConfigReader) {
  const enabled =
    config.get<string | boolean>("APPLICATION_EVENTS_ENABLED") ?? true;
  if (![true, false, "true", "false"].includes(enabled))
    throw new Error("APPLICATION_EVENTS_ENABLED invalido");
  const interval = Number(config.get("APPLICATION_OUTBOX_INTERVAL_MS") ?? 1000);
  if (!Number.isInteger(interval) || interval < 100 || interval > 60000)
    throw new Error("APPLICATION_OUTBOX_INTERVAL_MS invalido");
  const topic =
    config.get<string>("APPLICATION_KAFKA_TOPIC") ?? "application.events.v1";
  const queue = config.get<string>("AUTH_AUDIT_QUEUE") ?? "audit_queue";
  if (
    !/^[a-zA-Z0-9_.-]{1,200}$/.test(topic) ||
    !/^[a-zA-Z0-9_.-]{1,200}$/.test(queue) ||
    queue.startsWith("amq.")
  )
    throw new Error("Topic o cola de auditoria invalido");
  return {
    enabled: enabled === true || enabled === "true",
    interval,
    topic,
    queue,
  };
}

export function kafkaClientConfig(config: ConfigReader, clientId: string) {
  const brokers = (
    config.get<string>("KAFKA_BROKERS") ??
    config.get<string>("KAFKA_BROKER") ??
    "localhost:9092"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!brokers.length) throw new Error("KAFKA_BROKERS es obligatorio");
  const tls = config.get<string | boolean>("KAFKA_SSL") ?? false;
  if (![true, false, "true", "false"].includes(tls))
    throw new Error("KAFKA_SSL invalido");
  const mechanism = config.get<string>("KAFKA_SASL_MECHANISM");
  const username = config.get<string>("KAFKA_SASL_USERNAME");
  const password = config.get<string>("KAFKA_SASL_PASSWORD");
  const base = {
    clientId,
    brokers,
    ssl: tls === true || tls === "true",
    connectionTimeout: 5000,
    requestTimeout: 5000,
  };
  if (!mechanism && !username && !password) return base;
  if (!username || !password)
    throw new Error("Configura las credenciales SASL de Kafka");
  if (mechanism === "plain")
    return {
      ...base,
      sasl: { mechanism: "plain" as const, username, password },
    };
  if (mechanism === "scram-sha-256")
    return {
      ...base,
      sasl: { mechanism: "scram-sha-256" as const, username, password },
    };
  if (mechanism === "scram-sha-512")
    return {
      ...base,
      sasl: { mechanism: "scram-sha-512" as const, username, password },
    };
  throw new Error("KAFKA_SASL_MECHANISM no soportado");
}
