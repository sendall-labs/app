export function explorerTxUrl(network: string, txHash: string): string {
  const segment = network === "PUBLIC" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${segment}/tx/${txHash}`;
}

export function explorerAccountUrl(network: string, address: string): string {
  const segment = network === "PUBLIC" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${segment}/account/${address}`;
}
