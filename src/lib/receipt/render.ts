import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { ReceiptDocument } from "./ReceiptDocument";
import type { ReceiptData } from "./receiptData";

export async function renderReceipt(data: ReceiptData): Promise<Buffer> {
  return renderToBuffer(createElement(ReceiptDocument, { data }) as unknown as ReactElement<DocumentProps>);
}
