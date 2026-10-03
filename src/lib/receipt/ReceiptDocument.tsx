import { Document, Font, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { explorerAccountUrl, explorerTxUrl } from "@/lib/stellar/explorer";
import type { ReceiptData } from "./receiptData";

// Never hyphenate: a hyphen inserted into a Stellar address or hash
// would print a wrong value on a document people file and verify.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#18181b";
const MUTED = "#6b7280";
const FAINT = "#9ca09c";
const LINE = "#e5e3de";
const ACCENT = "#2f5fda";
const OK = "#15803d";
const BAD = "#b91c1c";

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 32, fontFamily: "Helvetica", fontSize: 8, color: INK },
  brand: { fontSize: 16, fontFamily: "Helvetica-Bold", color: ACCENT },
  title: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  muted: { color: MUTED },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  meta: { flexDirection: "row", flexWrap: "wrap", marginTop: 16, borderTop: `1 solid ${LINE}`, borderBottom: `1 solid ${LINE}`, paddingVertical: 10 },
  metaCell: { width: "33.33%", paddingVertical: 4, paddingRight: 8 },
  metaLabel: { fontSize: 6.5, color: FAINT, textTransform: "uppercase", letterSpacing: 0.4 },
  metaValue: { fontSize: 9, marginTop: 2 },
  mono: { fontFamily: "Courier" },
  totals: { flexDirection: "row", marginTop: 12, marginBottom: 14 },
  totalBox: { flexGrow: 1, borderRadius: 4, backgroundColor: "#f3f2ee", padding: 8, marginRight: 6 },
  totalValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  th: { flexDirection: "row", borderBottom: `1 solid ${INK}`, paddingBottom: 4, marginBottom: 2 },
  thText: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase" },
  tr: { flexDirection: "row", borderBottom: `0.5 solid ${LINE}`, paddingVertical: 3.5, alignItems: "center" },
  cIdx: { width: 22 },
  cAddr: { width: 210 },
  cAmt: { width: 48, textAlign: "right", paddingRight: 8 },
  cMethod: { width: 74, paddingRight: 6 },
  cStatus: { width: 84, paddingRight: 6 },
  cTx: { flexGrow: 1 },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 6.5, color: FAINT },
});

function fmtDate(d: Date) {
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaLabel}>{label}</Text>
      <View style={s.metaValue}>{typeof children === "string" ? <Text>{children}</Text> : children}</View>
    </View>
  );
}

/**
 * Invoice-style receipt for one distribution: who sent what, on which
 * network, then one line per recipient with how it was delivered, its
 * status and the transaction it went out in. Every hash links to a public
 * explorer so the document can be checked independently.
 */
export function ReceiptDocument({ data }: { data: ReceiptData }) {
  const network = data.network === "PUBLIC" ? "Stellar Mainnet" : "Stellar Testnet";
  return (
    <Document title={`Sendall receipt ${data.number}`} author="Sendall" subject={data.title}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.brand}>Sendall</Text>
            <Text style={s.title}>Distribution receipt</Text>
            <Text style={s.muted}>{data.title}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.metaLabel}>Receipt</Text>
            <Text style={[s.metaValue, s.mono]}>{data.number}</Text>
            <Text style={[s.metaLabel, { marginTop: 6 }]}>Date</Text>
            <Text style={s.metaValue}>{fmtDate(data.date)}</Text>
          </View>
        </View>

        <View style={s.meta}>
          <View style={[s.metaCell, { width: "100%" }]}>
            <Text style={s.metaLabel}>Sender</Text>
            <Link src={explorerAccountUrl(data.network, data.sender)} style={[s.metaValue, s.mono, { color: ACCENT, fontSize: 8 }]}>
              {data.sender}
            </Link>
          </View>
          <Meta label="Network">{network}</Meta>
          <Meta label="Asset">{data.asset.issuer ? `${data.asset.code} (${data.asset.issuer.slice(0, 6)}…${data.asset.issuer.slice(-4)})` : "XLM (native)"}</Meta>
          <Meta label="Delivery">{data.kind === "CLAIMABLE_BALANCE" ? "Claimable balances" : "Direct payments"}</Meta>
          <Meta label="Stellar transactions">{String(data.transactionCount)}</Meta>
          <Meta label="Network fees">Paid by Sendall</Meta>
          {data.claimDeadline && <Meta label="Claimable until">{fmtDate(data.claimDeadline)}</Meta>}
        </View>

        <View style={s.totals}>
          <View style={s.totalBox}>
            <Text style={s.metaLabel}>Total delivered</Text>
            <Text style={s.totalValue}>
              {data.deliveredAmount} {data.asset.code}
            </Text>
          </View>
          <View style={s.totalBox}>
            <Text style={s.metaLabel}>Recipients</Text>
            <Text style={s.totalValue}>
              {data.deliveredCount} of {data.recipientCount}
            </Text>
          </View>
          <View style={[s.totalBox, { marginRight: 0 }]}>
            <Text style={s.metaLabel}>Not delivered</Text>
            <Text style={[s.totalValue, { color: data.failedCount ? BAD : INK }]}>{data.failedCount}</Text>
          </View>
        </View>

        <View style={s.th} fixed>
          <Text style={[s.thText, s.cIdx]}>#</Text>
          <Text style={[s.thText, s.cAddr]}>Recipient</Text>
          <Text style={[s.thText, s.cAmt]}>Amount</Text>
          <Text style={[s.thText, s.cMethod]}>Method</Text>
          <Text style={[s.thText, s.cStatus]}>Status</Text>
          <Text style={[s.thText, s.cTx]}>Transaction</Text>
        </View>
        {data.rows.map((r) => (
          <View key={r.index} style={s.tr} wrap={false}>
            <Text style={[s.cIdx, s.muted]}>{r.index}</Text>
            <Text style={[s.cAddr, s.mono, { fontSize: 5.9 }]}>{r.address}</Text>
            <Text style={s.cAmt}>{r.amount}</Text>
            <Text style={s.cMethod}>{r.method}</Text>
            <Text style={[s.cStatus, { color: r.delivered ? OK : BAD }]}>{r.status}</Text>
            {r.txHash ? (
              <Link src={explorerTxUrl(data.network, r.txHash)} style={[s.cTx, s.mono, { color: ACCENT, fontSize: 6.5 }]}>
                {r.txHash.slice(0, 16)}…
              </Link>
            ) : (
              <Text style={[s.cTx, s.muted]}>-</Text>
            )}
          </View>
        ))}

        {data.authorizationTxs.length > 0 && (
          <View style={{ marginTop: 12 }} wrap={false}>
            <Text style={s.metaLabel}>Sender authorization</Text>
            {data.authorizationTxs.map((h) => (
              <Link key={h} src={explorerTxUrl(data.network, h)} style={[s.mono, { color: ACCENT, fontSize: 6.5, marginTop: 2 }]}>
                {h}
              </Link>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>
            Sendall · {data.number} · Every transaction can be verified on stellar.expert
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
