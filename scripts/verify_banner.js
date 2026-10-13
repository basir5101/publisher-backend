import { chromium } from 'playwright';
import { buildBannerData, generateBannerScreenshot } from './banner_generator.js';

async function testBanner() {
    console.log('Testing banner generation...');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const mockInsights = {
        metadata: {
            title: "Sweet Potato Chips Market Analysis & Forecast 2025-2034"
        },
        data: {
            marketKeyword: "Sweet Potato Chips Market",
            cagr: "7.8",
            marketSize: "450 Million",
            baseYear: "2025",
            drivers: [
                "Surging global demand for clean-label, vegan root vegetable snacks and kettle-cooked alternatives."
            ],
            restraints: [
                "Agricultural yield variations and raw tuber supply chain price volatility."
            ]
        }
    };

    const bannerConfig = buildBannerData({
        marketKeyword: mockInsights.data.marketKeyword,
        title: mockInsights.metadata.title,
        cagr: mockInsights.data.cagr,
        marketSize: mockInsights.data.marketSize,
        baseYear: mockInsights.data.baseYear,
        drivers: mockInsights.data.drivers,
        restraints: mockInsights.data.restraints
    });

    const outputPath = 'banners/test-sweet-potato-chips.png';
    const result = await generateBannerScreenshot({
        page,
        bannerData: bannerConfig,
        outputPath
    });

    await browser.close();
    console.log('Test complete! Result:', result.success, 'Output path:', result.outputPath);
}

testBanner().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
