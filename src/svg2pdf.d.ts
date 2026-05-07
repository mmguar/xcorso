declare module 'svg2pdf.js' {
  import { jsPDF } from 'jspdf'

  interface Svg2pdfOptions {
    x?: number
    y?: number
    width?: number
    height?: number
  }

  export function svg2pdf(element: Element, pdf: jsPDF, options?: Svg2pdfOptions): Promise<jsPDF>
}
