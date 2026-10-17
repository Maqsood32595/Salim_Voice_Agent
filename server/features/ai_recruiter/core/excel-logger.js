import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXCEL_FILE_PATH = path.resolve(__dirname, '../../interested_candidates.xlsx');

/**
 * Excel Logger for Interested Job Candidates
 * Automatically creates and updates `interested_candidates.xlsx`
 */
export class ExcelLogger {
  constructor() {
    this.filePath = EXCEL_FILE_PATH;
    this.ensureExcelFile();
  }

  ensureExcelFile() {
    if (!fs.existsSync(this.filePath)) {
      const headers = [
        ['Timestamp', 'Candidate Name', 'Phone Number', 'Status', 'Candidate Response', 'Agency Notes']
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(headers);
      
      // Set column widths for readability
      worksheet['!cols'] = [
        { wch: 22 }, // Timestamp
        { wch: 20 }, // Candidate Name
        { wch: 18 }, // Phone Number
        { wch: 18 }, // Status
        { wch: 40 }, // Candidate Response
        { wch: 30 }  // Agency Notes
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Interested Candidates');
      XLSX.writeFile(workbook, this.filePath);
      console.log(`📊 [Excel Logger] Initialized new workbook at ${this.filePath}`);
    }
  }

  /**
   * Save an interested candidate to the Excel workbook
   * @param {Object} data { name, phone, response, notes }
   */
  saveInterestedCandidate({ name = 'Candidate', phone = 'Unknown', response = 'Yes', notes = 'Ready for HR Screening' }) {
    try {
      this.ensureExcelFile();

      const workbook = XLSX.readFile(this.filePath);
      const sheetName = workbook.SheetNames[0] || 'Interested Candidates';
      const worksheet = workbook.Sheets[sheetName];

      const existingData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const timestamp = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      const newRow = [
        timestamp,
        name,
        phone,
        'INTERESTED (YES)',
        response,
        notes
      ];

      existingData.push(newRow);

      const updatedWorksheet = XLSX.utils.aoa_to_sheet(existingData);
      updatedWorksheet['!cols'] = [
        { wch: 22 },
        { wch: 20 },
        { wch: 18 },
        { wch: 18 },
        { wch: 40 },
        { wch: 30 }
      ];

      workbook.Sheets[sheetName] = updatedWorksheet;
      XLSX.writeFile(workbook, this.filePath);

      console.log(`✅ [Excel Logger] Saved Interested Candidate: ${name} (${phone}) to Excel`);
      return { success: true, name, phone, timestamp };
    } catch (err) {
      console.error('❌ [Excel Logger] Error saving to Excel:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get all currently saved candidates as structured JSON for dashboard
   */
  getAllInterestedCandidates() {
    try {
      if (!fs.existsSync(this.filePath)) return [];

      const workbook = XLSX.readFile(this.filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet);

      return rows.map((r, i) => ({
        id: i + 1,
        timestamp: r['Timestamp'] || '',
        name: r['Candidate Name'] || 'Candidate',
        phone: r['Phone Number'] || '',
        status: r['Status'] || 'INTERESTED',
        response: r['Candidate Response'] || '',
        notes: r['Agency Notes'] || ''
      }));
    } catch (err) {
      console.error('❌ [Excel Logger] Error reading Excel:', err.message);
      return [];
    }
  }

  /**
   * Sync the excel file with database candidates before downloading
   */
  syncFromDatabase(candidates) {
    try {
      const workbook = XLSX.utils.book_new();
      const headers = ['Timestamp', 'Candidate Name', 'Phone Number', 'Status', 'Candidate Response', 'Agency Notes'];
      
      // Group by Month -> Week
      const grouped = {};
      
      candidates.forEach(c => {
        let date;
        try {
          date = new Date(c.timestamp);
          if (isNaN(date.getTime())) date = new Date();
        } catch(e) {
          date = new Date();
        }
        
        const monthName = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        
        // Calculate week of month (1-5)
        const dateDate = date.getDate();
        const weekNum = Math.ceil(dateDate / 7);
        const weekName = `Week ${weekNum}`;
        
        if (!grouped[monthName]) grouped[monthName] = {};
        if (!grouped[monthName][weekName]) grouped[monthName][weekName] = [];
        
        grouped[monthName][weekName].push([
          c.timestamp || '',
          c.name || 'Candidate',
          c.phone || '',
          c.status || 'INTERESTED',
          c.response || c.response_text || '',
          'Synced from PostgreSQL'
        ]);
      });
      
      // Create sheets for each month
      for (const [month, weeks] of Object.entries(grouped)) {
        const sheetData = [];
        
        for (const [week, rows] of Object.entries(weeks)) {
          // Add spacing if not first row
          if (sheetData.length > 0) {
            sheetData.push([]);
            sheetData.push([]);
          }
          
          sheetData.push([`--- ${week.toUpperCase()} ---`]);
          sheetData.push(headers);
          rows.forEach(r => sheetData.push(r));
        }
        
        const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
        worksheet['!cols'] = [{wch:22}, {wch:20}, {wch:18}, {wch:18}, {wch:40}, {wch:30}];
        
        // Excel sheet names max 31 chars
        const safeSheetName = month.substring(0, 31);
        XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
      }
      
      // If no candidates, create a default empty sheet
      if (Object.keys(grouped).length === 0) {
        const worksheet = XLSX.utils.aoa_to_sheet([headers]);
        worksheet['!cols'] = [{wch:22}, {wch:20}, {wch:18}, {wch:18}, {wch:40}, {wch:30}];
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Interested Candidates');
      }

      XLSX.writeFile(workbook, this.filePath);
    } catch (err) {
      console.error('❌ [Excel Logger] Error syncing from database:', err.message);
    }
  }
}

export const excelLogger = new ExcelLogger();
