// Secondary bundle-leak guard for provider key prefixes. Literal private env
// scanning remains the primary protection; update this pattern when adding a
// provider whose keys have a recognizable public prefix.
export const PRIVATE_SECRET_PREFIX_PATTERN =
  /\b(?:sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|pa-[A-Za-z0-9_-]+|bt_[A-Za-z0-9_-]+)\b/g;
