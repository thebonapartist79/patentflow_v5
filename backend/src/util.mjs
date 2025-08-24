// Utility to clean patent numbers
export function extractPatentTokens(text){return text?text.split(/[^0-9A-Za-z]+/g).filter(Boolean):[];}
