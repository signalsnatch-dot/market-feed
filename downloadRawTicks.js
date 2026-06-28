// ============================================
// TICK DATA DOWNLOADER - AUTOMATIC SAVE
// ============================================
// Run this in browser console (F12 -> Console)
// 
// USAGE EXAMPLES:
// downloadTicksAuto()                    // Downloads all files for today
// downloadTicksAuto('MCX_FO')           // Downloads all MCX_FO files for today
// downloadTicksAuto('MCX_FO', '2026-06-24') // Downloads MCX_FO files for June 24, 2026
// ============================================

function downloadTicksAuto(prefix = null, date = null) {
    // Get today's date if not provided
    if (!date) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        date = `${year}-${month}-${day}`;
    }

    // Get all anchor links on the page
    const links = document.querySelectorAll('a[href*=".csv"]');
    
    // Filter links based on prefix and date
    let matchingLinks = [];
    
    links.forEach(link => {
        const href = link.getAttribute('href');
        
        // Check if link matches the date
        if (href.includes(date)) {
            // If prefix is provided, check if it matches
            if (prefix) {
                if (href.includes(prefix)) {
                    matchingLinks.push(link);
                }
            } else {
                matchingLinks.push(link);
            }
        }
    });

    if (matchingLinks.length === 0) {
        console.log(`❌ No files found for ${prefix ? prefix + ' ' : ''}date: ${date}`);
        return;
    }

    console.log(`✅ Found ${matchingLinks.length} files to download:`);
    matchingLinks.forEach(link => {
        console.log(`  - ${link.textContent}`);
    });

    const confirmDownload = confirm(
        `Ready to download ${matchingLinks.length} file(s) for ${date}${prefix ? ' with prefix "' + prefix + '"' : ''}?\n\nClick OK to start downloading.`
    );

    if (!confirmDownload) {
        console.log('❌ Download cancelled by user.');
        return;
    }

    // Method 1: Use fetch API to download files programmatically
    async function downloadFile(url, filename) {
        try {
            console.log(`⬇️ Downloading: ${filename}`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const blob = await response.blob();
            
            // Create download link
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            
            // Cleanup
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
            }, 100);
            
            return true;
        } catch (error) {
            console.error(`❌ Error downloading ${filename}:`, error);
            return false;
        }
    }

    // Download files sequentially
    async function downloadAll() {
        console.log('⏳ Starting downloads...');
        
        for (let i = 0; i < matchingLinks.length; i++) {
            const link = matchingLinks[i];
            const url = link.getAttribute('href');
            const filename = link.textContent;
            
            console.log(`📥 [${i + 1}/${matchingLinks.length}] Downloading ${filename}`);
            
            try {
                await downloadFile(url, filename);
                console.log(`✅ [${i + 1}/${matchingLinks.length}] Completed: ${filename}`);
            } catch (error) {
                console.error(`❌ [${i + 1}/${matchingLinks.length}] Failed: ${filename}`);
            }
            
            // Small delay between downloads
            if (i < matchingLinks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        console.log('🎉 All downloads completed!');
        console.log(`📁 Files should be in your Downloads folder`);
    }

    // Start the download process
    downloadAll();
}

// ============================================
// QUICK COMMANDS FOR MCX_FO JUNE 24, 2026
// ============================================

// Download MCX_FO files for June 24, 2026
function downloadMCX_24() {
    downloadTicksAuto('MCX_FO', '2026-06-24');
}

// Download ALL files for June 24, 2026
function downloadAll_24() {
    downloadTicksAuto(null, '2026-06-24');
}

// Download MCX_FO files for today
function downloadMCXTodayAuto() {
    downloadTicksAuto('MCX_FO');
}

// ============================================
// EXECUTE DOWNLOAD - UNCOMMENT THE LINE BELOW
// ============================================

// Run this to download MCX_FO for June 24, 2026
//downloadTicksAuto('MCX_FO', '2026-06-24');

// Or run this to download ALL files for June 24, 2026
// downloadTicksAuto(null, '2026-06-24');