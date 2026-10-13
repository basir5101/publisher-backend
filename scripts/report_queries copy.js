import pool from './db.js';

// Simple db call for checking payment_gateway table
export async function findInactiveMarketKeywords(prefix) {
    const reportTable = `${prefix}_report`
    try {
        console.log('Connecting to PostgreSQL...');
        const result = await pool.query(`
            SELECT id, "active",  "marketKeyword", "categoryId"
            FROM "${reportTable}"
            WHERE id = 1991766
            limit 1;
        `);

        console.log(`Successfully queried ${reportTable} table. Found ${result.rowCount} rows.`);

        // Fix: Return just the rows array for easier handling later
        return result.rows;
    } catch (err) {
        // Fix: Log the full error stack for better troubleshooting
        console.error('Error executing query:', err.stack);
        throw err;
    }
}


function getUnitValue(str) {
    const match = str.match(/^([\d.,]+)\s*(.+)$/);
    if (match) {
        const marketValue = parseFloat(match[1]); // 1.24 (number)
        const unit = match[2].trim();        // "Billion" (string)
        return { marketValue, unit }
    }
}

function parseNestedString(input) {
    // Clean up wrapping quotes or prefixes like "regions: '"
    const cleaned = input.replace(/regions:\s*['"]?/gi, '').replace(/['"]/g, '');

    const categories = [];
    let depth = 0;
    let categoryName = '';
    let content = '';

    for (let i = 0; i < cleaned.length; i++) {
        const char = cleaned[i];

        if (char === '(') {
            if (depth === 0) {
                // We found the opening bracket for a category
                categoryName = categoryName.trim().replace(/^,\s*/, '');
            } else {
                // Inner parenthesis (e.g., "(STS)" or "(IMDG)")
                content += char;
            }
            depth++;
        } else if (char === ')') {
            depth--;
            if (depth === 0) {
                // We reached the matching closing bracket for the category
                const subItems = splitSubItems(content).map((item) => ({
                    name: item.trim()
                }));

                if (categoryName) {
                    categories.push({
                        name: categoryName.trim(),
                        sub_items: subItems
                    });
                }

                categoryName = '';
                content = '';
            } else {
                content += char;
            }
        } else {
            if (depth === 0) {
                categoryName += char;
            } else {
                content += char;
            }
        }
    }

    return categories;
}

// Split items on commas, ignoring commas inside nested parentheses
function splitSubItems(str) {
    const items = [];
    let depth = 0;
    let current = '';

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '(') depth++;
        if (char === ')') depth--;

        if (char === ',' && depth === 0) {
            if (current.trim()) items.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    if (current.trim()) items.push(current.trim());
    return items;
}

export async function updateReport(summaryLog) {
    const { id, prefix, active, meta_title, meta_description, region, cagr, marketSize, baseYear, volumeUnit, trends, restraints, drivers, challenges, segments, companies, developments, faq, regions, rd_r2_key, rm_r2_key } = summaryLog;
    const tables = {
        report: `${prefix}_report`,
        analysis: `${prefix}_marketAnalysis`,
        marketReport: `${prefix}_marketReport`,
        rd: `${prefix}_rd`,
    };

    const { marketValue, unit } = getUnitValue(marketSize)

    const marketData = {
        cagr: String(cagr),
        marketSize: String(marketValue),
        baseYear: String(baseYear),
        volumeUnit,
        valueUnit: unit,
    };

    await prisma[tables.report].update({
        where: { id: id },
        data: {
            active: true,
            updatedAt: new Date(),
            ...(active ? {} : { publishedAt: new Date() }),
            region,
            marketData,
            baseyear: baseYear,
            seoengine: active ? true : false,
            title: meta_title,
            // images: chartImages,
            aicharts: true,
            aird: true,
            // seo: { keywords: focusEntities || "" },
            summery: meta_description || "",
            faq,
            method_r2key: rm_r2_key,
            method_updatedAt: new Date(),
            // linkCount: (report.linkCount || 0) + linkList.length,
            [tables.rd]: {
                upsert: {
                    create: {
                        // chart: JSON.stringify(chart_data_content),
                        updatedAt: new Date(),
                        r2Key: rd_r2_key,
                    },
                    update: {
                        // chart: JSON.stringify(chart_data_content),
                        updatedAt: new Date(),
                        r2Key: rd_r2_key,
                    },
                },
            },
            [tables.analysis]: {
                developments: developments,
                segments_json: parseNestedString(segments),
                regionData_json: parseNestedString(regions),
                companies: companies
            },
            [tables.marketReport]: {
                drivers: drivers?.toString() || "",
                trends: trends?.toString() || "",
                restrains: restraints?.toString() || "",
            }
        },
    });
    console.log('\n💡 === Generated Report AI Output ===');
    console.dir(summaryLog, { depth: null, colors: true });

}


