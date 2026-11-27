export const NEW_PUBLISHERS = ["imd", "ira"];

export const isNewPublisher = (prefix) =>
  Boolean(prefix && NEW_PUBLISHERS.includes(String(prefix).toLowerCase()));

export const PUBLISHER_SITES = [
  // --- Old / Legacy Publishers ---
  {
    domain: "archivemarketresearch.com",
    siteUrl: "sc-domain:archivemarketresearch.com",
    publisherCode: "amr",
    type: "old",
  },
  {
    domain: "datainsightsmarket.com",
    siteUrl: "sc-domain:datainsightsmarket.com",
    publisherCode: "dim",
    type: "old",
  },
  {
    domain: "promarketreports.com",
    siteUrl: "sc-domain:promarketreports.com",
    publisherCode: "pmr",
    type: "old",
  },
  {
    domain: "marketreportanalytics.com",
    siteUrl: "sc-domain:marketreportanalytics.com",
    publisherCode: "mra",
    type: "old",
  },
  {
    domain: "datainsightsreports.com",
    siteUrl: "sc-domain:datainsightsreports.com",
    publisherCode: "dir",
    type: "old",
  },
  {
    domain: "marketlensiq.com",
    siteUrl: "sc-domain:marketlensiq.com",
    publisherCode: "miq",
    type: "old",
  },
  {
    domain: "sectordatainsights.com",
    siteUrl: "sc-domain:sectordatainsights.com",
    publisherCode: "sdi",
    type: "old",
  },
  {
    domain: "marketdatapulse.com",
    siteUrl: "sc-domain:marketdatapulse.com",
    publisherCode: "mpu",
    type: "old",
  },
  {
    domain: "industrydatainsights.com",
    siteUrl: "sc-domain:industrydatainsights.com",
    publisherCode: "idi",
    type: "old",
  },
  {
    domain: "researchinsighthub.com",
    siteUrl: "sc-domain:researchinsighthub.com",
    publisherCode: "rih",
    type: "old",
  },

  // --- New Publishers ---
  {
    domain: "insightmarketdata.com",
    siteUrl: "sc-domain:insightmarketdata.com",
    publisherCode: "imd",
    type: "new",
  },
  {
    domain: "industryresearchanalytics.com",
    siteUrl: "sc-domain:industryresearchanalytics.com",
    publisherCode: "ira",
    type: "new",
  },
];

export const DEFAULT_REPORT_PRICE = {
  singlePrice: 4480.0,
  multiPrice: 6720.0,
  enterprisePrice: 8960.0,
};

export function getNoOfPages() {
  return String(Math.floor(Math.random() * (280 - 180 + 1)) + 180);
}
