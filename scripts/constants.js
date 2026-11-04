export const NEW_PUBLISHERS = ["imd"];

export const isNewPublisher = (prefix) =>
  Boolean(prefix && NEW_PUBLISHERS.includes(String(prefix).toLowerCase()));
