// CV PDF Renderer - Client-side PDF generation
import React from 'react';
import { PDFDownloadLink, PDFViewer, pdf } from '@react-pdf/renderer';
import { CVDocument } from './CVDocument';
import { TailoredCV } from './tailoring-engine';
import { Logger } from '../util/logger';

const log = new Logger({ namespace: "pdf-renderer", level: "debug", persist: true });

interface CVPDFRendererProps {
  cv: TailoredCV;
  jobInfo?: {
    title: string;
    company: string;
  };
  onDownloadComplete?: () => void;
}

// Component for rendering PDF in browser
export const CVPDFViewer: React.FC<CVPDFRendererProps> = ({ cv }) => {
  return (
    <PDFViewer width="100%" height="600" style={{ border: 'none' }}>
      <CVDocument cv={cv} />
    </PDFViewer>
  );
};

// Component for download link
export const CVPDFDownload: React.FC<CVPDFRendererProps> = ({ 
  cv, 
  jobInfo,
  onDownloadComplete 
}) => {
  const fileName = jobInfo 
    ? `${jobInfo.company.replace(/\s+/g, '_')}_${jobInfo.title.replace(/\s+/g, '_')}_CV.pdf`
    : 'Tailored_CV.pdf';

  return (
    <PDFDownloadLink
      document={<CVDocument cv={cv} />}
      fileName={fileName}
      onClick={() => {
        log.info("CV PDF download initiated", { fileName });
        onDownloadComplete?.();
      }}
      style={{
        background: 'linear-gradient(45deg, #10b981, #059669)',
        border: 'none',
        color: 'white',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        textDecoration: 'none',
        display: 'inline-block',
      }}
    >
      {({ blob, url, loading, error }) =>
        loading ? 'Generating PDF...' : '📄 Download CV'
      }
    </PDFDownloadLink>
  );
};

// Utility function to generate PDF blob
export const generatePDFBlob = async (cv: TailoredCV): Promise<Blob> => {
  try {
    log.info("Generating PDF blob", { 
      name: cv.personalInfo.name,
      tailoringScore: cv.tailoringScore 
    });

    const doc = <CVDocument cv={cv} />;
    const blob = await pdf(doc).toBlob();
    
    log.info("PDF blob generated successfully", {
      size: blob.size,
      type: blob.type
    });

    return blob;
  } catch (error) {
    log.error("Failed to generate PDF blob", { error });
    throw error;
  }
};

// Utility function to generate and download PDF
export const downloadCVPDF = async (
  cv: TailoredCV, 
  jobInfo?: { title: string; company: string }
): Promise<void> => {
  try {
    const blob = await generatePDFBlob(cv);
    
    const fileName = jobInfo 
      ? `${jobInfo.company.replace(/\s+/g, '_')}_${jobInfo.title.replace(/\s+/g, '_')}_CV.pdf`
      : 'Tailored_CV.pdf';
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    log.info("CV PDF downloaded successfully", { fileName });
  } catch (error) {
    log.error("Failed to download CV PDF", { error });
    throw error;
  }
};

export default CVPDFDownload;