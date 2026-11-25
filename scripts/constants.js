export const NEW_PUBLISHERS = ["imd", "ira"];

export const isNewPublisher = (prefix) =>
  Boolean(prefix && NEW_PUBLISHERS.includes(String(prefix).toLowerCase()));
