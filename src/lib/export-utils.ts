/**
 * Utility functions for exporting data to various formats
 */

/**
 * Convert array of objects to CSV format
 */
export function convertToCSV(data: any[], headers?: string[]): string {
  if (!data || data.length === 0) {
    return '';
  }

  // Get headers from first object if not provided
  const keys = headers || Object.keys(data[0]);
  
  // Create CSV header row
  const csvHeaders = keys.join(',');
  
  // Create CSV data rows
  const csvRows = data.map(row => {
    return keys.map(key => {
      const value = row[key];
      // Handle values that need escaping (commas, quotes, newlines)
      if (value === null || value === undefined) {
        return '';
      }
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    }).join(',');
  });
  
  return [csvHeaders, ...csvRows].join('\n');
}

/**
 * Download a file with the given content
 */
export function downloadFile(content: string, filename: string, mimeType = 'text/csv'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export transactions to CSV file
 */
export function exportTransactionsToCSV(transactions: any[], filename?: string): void {
  const csvContent = convertToCSV(transactions);
  const defaultFilename = filename || `transactions-${new Date().toISOString().split('T')[0]}.csv`;
  downloadFile(csvContent, defaultFilename);
}

export default {
  convertToCSV,
  downloadFile,
  exportTransactionsToCSV,
};
