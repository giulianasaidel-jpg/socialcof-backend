/**
 * One-time script — seeds the MedNewsSource collection from the fontes_medicas_apify.xlsx list.
 * Already-existing entries (by URL) are skipped.
 *
 * Run:
 *   pnpm ts-node-dev --transpile-only --no-notify --watch "" src/scripts/seedMedNewsSources.ts
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import { MedNewsSource, NewsMethod, NewsPriority } from '../models/MedNewsSource';
import { NewsCategory, NewsLanguage, NewsSpecialty } from '../models/MedicalNews';

interface SeedEntry {
  name: string;
  url: string;
  newsPageUrl?: string;
  category: NewsCategory;
  language: NewsLanguage;
  specialty: NewsSpecialty;
  priority: NewsPriority;
  method: NewsMethod;
  country: string;
}

function mapCategory(raw: string): NewsCategory {
  switch (raw) {
    case 'Pesquisa': case 'Preprint': return 'research';
    case 'Jornal': return 'journal';
    case 'Diretrizes': return 'guidelines';
    case 'Regulatorio': return 'government';
    case 'Residencia': return 'education';
    case 'Sociedade': return 'society' as NewsCategory;
    case 'Noticias': return 'news' as NewsCategory;
    default: return 'global';
  }
}

function mapLanguage(country: string): NewsLanguage {
  return country === 'Brasil' ? 'pt' : 'en';
}

function mapMethod(raw: string): NewsMethod {
  if (raw.startsWith('API')) return 'api';
  if (raw.includes('RSS')) return 'rss';
  return 'html';
}

const SOURCES: SeedEntry[] = [
  { name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov', category: mapCategory('Pesquisa'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P1', method: 'api', country: 'Global' },
  { name: 'NCBI', url: 'https://www.ncbi.nlm.nih.gov', category: mapCategory('Pesquisa'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P1', method: 'api', country: 'Global' },
  { name: 'Europe PMC', url: 'https://europepmc.org', category: mapCategory('Pesquisa'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P1', method: 'api', country: 'Global' },
  { name: 'Crossref', url: 'https://www.crossref.org', category: mapCategory('Pesquisa'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P1', method: 'api', country: 'Global' },
  { name: 'ClinicalTrials.gov', url: 'https://clinicaltrials.gov', category: mapCategory('Pesquisa'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P1', method: 'api', country: 'EUA' },

  { name: 'WHO Publications', url: 'https://www.who.int/publications', category: mapCategory('Diretrizes'), language: mapLanguage('Global'), specialty: 'preventiva', priority: 'P1', method: 'rss', country: 'Global' },
  { name: 'WHO Newsroom', url: 'https://www.who.int/news-room', category: mapCategory('Noticias'), language: mapLanguage('Global'), specialty: 'preventiva', priority: 'P1', method: 'rss', country: 'Global' },

  { name: 'Nature', url: 'https://www.nature.com', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'Global' },
  { name: 'ScienceDirect', url: 'https://www.sciencedirect.com', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P2', method: 'rss', country: 'Global' },
  { name: 'Springer Link', url: 'https://link.springer.com', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P2', method: 'rss', country: 'Global' },
  { name: 'Wiley Online Library', url: 'https://onlinelibrary.wiley.com', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P2', method: 'rss', country: 'Global' },
  { name: 'Taylor & Francis', url: 'https://www.tandfonline.com', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P2', method: 'rss', country: 'Global' },
  { name: 'Cell Press', url: 'https://www.cell.com', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'Global' },
  { name: 'Science Magazine', url: 'https://www.science.org', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'Global' },
  { name: 'PNAS', url: 'https://www.pnas.org', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P2', method: 'rss', country: 'Global' },

  { name: 'BMJ', url: 'https://www.bmj.com', category: mapCategory('Jornal'), language: mapLanguage('Reino Unido'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'Reino Unido' },
  { name: 'NEJM', url: 'https://www.nejm.org', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'JAMA Network', url: 'https://jamanetwork.com', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'The Lancet', url: 'https://www.thelancet.com', category: mapCategory('Jornal'), language: mapLanguage('Reino Unido'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'Reino Unido' },
  { name: 'Annals of Internal Medicine', url: 'https://www.acpjournals.org/journal/aim', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'CMAJ', url: 'https://www.cmaj.ca', category: mapCategory('Jornal'), language: mapLanguage('Canada'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'Canada' },
  { name: 'eBioMedicine', url: 'https://www.thelancet.com/journals/ebiom', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'Global' },

  { name: 'medRxiv', url: 'https://www.medrxiv.org', category: mapCategory('Preprint'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'Global' },
  { name: 'bioRxiv', url: 'https://www.biorxiv.org', category: mapCategory('Preprint'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P2', method: 'rss', country: 'Global' },

  { name: 'Cochrane Library', url: 'https://www.cochranelibrary.com', category: mapCategory('Diretrizes'), language: mapLanguage('Global'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'Global' },
  { name: 'Guideline Central', url: 'https://www.guidelinecentral.com', newsPageUrl: 'https://www.guidelinecentral.com/news/', category: mapCategory('Diretrizes'), language: mapLanguage('Global'), specialty: 'clinica_medica', priority: 'P1', method: 'html', country: 'Global' },

  { name: 'Medscape', url: 'https://www.medscape.com', category: mapCategory('Noticias'), language: mapLanguage('Global'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'Global' },
  { name: 'MedPage Today', url: 'https://www.medpagetoday.com', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'STAT', url: 'https://www.statnews.com', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'Fierce Biotech', url: 'https://www.fiercebiotech.com', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Fierce Healthcare', url: 'https://www.fiercehealthcare.com', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P3', method: 'rss', country: 'EUA' },
  { name: 'Healio', url: 'https://www.healio.com', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Medical Xpress', url: 'https://medicalxpress.com', category: mapCategory('Noticias'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P3', method: 'rss', country: 'Global' },
  { name: 'News Medical', url: 'https://www.news-medical.net', category: mapCategory('Noticias'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P3', method: 'rss', country: 'Global' },
  { name: 'Physician Weekly', url: 'https://www.physicianweekly.com', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P3', method: 'rss', country: 'EUA' },
  { name: 'HCPLive', url: 'https://www.hcplive.com', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P3', method: 'rss', country: 'EUA' },
  { name: 'Managed Healthcare Executive', url: 'https://www.managedhealthcareexecutive.com', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P3', method: 'rss', country: 'EUA' },
  { name: 'MDLinx', url: 'https://www.mdlinx.com', newsPageUrl: 'https://www.mdlinx.com/news', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P3', method: 'html', country: 'EUA' },
  { name: 'PharmaLive', url: 'https://www.pharmalive.com', category: mapCategory('Noticias'), language: mapLanguage('Global'), specialty: 'outras', priority: 'P3', method: 'rss', country: 'Global' },
  { name: 'Endpoints News', url: 'https://www.endpts.com', newsPageUrl: 'https://www.endpts.com/news/', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P2', method: 'html', country: 'EUA' },
  { name: 'Contemporary OBGYN', url: 'https://www.contemporaryobgyn.net', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'gineco', priority: 'P3', method: 'rss', country: 'EUA' },
  { name: 'Neurology Today', url: 'https://journals.lww.com/neurotodayonline', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P3', method: 'html', country: 'EUA' },
  { name: 'Oncology News Central', url: 'https://www.oncologynewscentral.com', category: mapCategory('Noticias'), language: mapLanguage('Global'), specialty: 'cirurgia', priority: 'P3', method: 'html', country: 'Global' },
  { name: 'Infectious Disease Advisor', url: 'https://www.infectiousdiseaseadvisor.com', category: mapCategory('Noticias'), language: mapLanguage('Global'), specialty: 'clinica_medica', priority: 'P3', method: 'html', country: 'Global' },

  { name: 'NICE Guidance', url: 'https://www.nice.org.uk/guidance', category: mapCategory('Diretrizes'), language: mapLanguage('Reino Unido'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'Reino Unido' },
  { name: 'CDC', url: 'https://www.cdc.gov', category: mapCategory('Diretrizes'), language: mapLanguage('EUA'), specialty: 'preventiva', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'FDA', url: 'https://www.fda.gov', category: mapCategory('Regulatorio'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'EMA', url: 'https://www.ema.europa.eu', category: mapCategory('Regulatorio'), language: mapLanguage('UE'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'UE' },
  { name: 'NIH', url: 'https://www.nih.gov', category: mapCategory('Noticias'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'AHRQ', url: 'https://www.ahrq.gov', newsPageUrl: 'https://www.ahrq.gov/news/index.html', category: mapCategory('Diretrizes'), language: mapLanguage('EUA'), specialty: 'preventiva', priority: 'P2', method: 'html', country: 'EUA' },
  { name: 'USPSTF', url: 'https://www.uspreventiveservicestaskforce.org', newsPageUrl: 'https://www.uspreventiveservicestaskforce.org/uspstf/announcements', category: mapCategory('Diretrizes'), language: mapLanguage('EUA'), specialty: 'preventiva', priority: 'P1', method: 'html', country: 'EUA' },
  { name: 'IDSA Guidelines', url: 'https://www.idsociety.org/practice-guideline/idsa-guidelines', newsPageUrl: 'https://www.idsociety.org/news--publications-new/articles/', category: mapCategory('Diretrizes'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'html', country: 'EUA' },
  { name: 'ACC/AHA Guidelines', url: 'https://www.acc.org/guidelines', newsPageUrl: 'https://www.acc.org/latest-in-cardiology/articles/', category: mapCategory('Diretrizes'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'html', country: 'EUA' },
  { name: 'ESC Guidelines', url: 'https://www.escardio.org/Guidelines', newsPageUrl: 'https://www.escardio.org/The-ESC/Press-Office/Press-releases', category: mapCategory('Diretrizes'), language: mapLanguage('UE'), specialty: 'clinica_medica', priority: 'P1', method: 'html', country: 'UE' },
  { name: 'ADA Standards of Care', url: 'https://diabetesjournals.org/care/issue/current', category: mapCategory('Diretrizes'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'html', country: 'EUA' },

  { name: 'CFM', url: 'https://portal.cfm.org.br', category: mapCategory('Regulatorio'), language: mapLanguage('Brasil'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'Brasil' },
  { name: 'Ministério da Saúde', url: 'https://www.gov.br/saude/pt-br', category: mapCategory('Regulatorio'), language: mapLanguage('Brasil'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'Brasil' },
  { name: 'ANVISA', url: 'https://www.gov.br/anvisa/pt-br', category: mapCategory('Regulatorio'), language: mapLanguage('Brasil'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'Brasil' },
  { name: 'CNRM MEC', url: 'https://www.gov.br/mec/pt-br/residencia-medica/comissao-nacional-de-residencia-medica', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'Resoluções Residência MEC', url: 'https://www.gov.br/mec/pt-br/residencia-medica/resolucao-residencia-medica', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'SisCNRM', url: 'https://siscnrm.mec.gov.br', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'CFM Residência Médica', url: 'https://portal.cfm.org.br/residencia-medica', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'Busca Normas CFM/CRM', url: 'https://portal.cfm.org.br/buscar-normas-cfm-e-crm', category: mapCategory('Regulatorio'), language: mapLanguage('Brasil'), specialty: 'outras', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'Conitec', url: 'https://www.gov.br/conitec', newsPageUrl: 'https://www.gov.br/conitec/pt-br/noticias', category: mapCategory('Diretrizes'), language: mapLanguage('Brasil'), specialty: 'outras', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'PCDT Conitec', url: 'https://www.gov.br/conitec/pt-br/assuntos/avaliacao-de-tecnologias-em-saude/protocolos-clinicos-e-diretrizes-terapeuticas', category: mapCategory('Diretrizes'), language: mapLanguage('Brasil'), specialty: 'outras', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'ENARE', url: 'https://enare.ebserh.gov.br', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'Diário Oficial da União', url: 'https://www.in.gov.br', category: mapCategory('Regulatorio'), language: mapLanguage('Brasil'), specialty: 'outras', priority: 'P1', method: 'html', country: 'Brasil' },

  { name: 'Sociedade Brasileira de Cardiologia', url: 'https://www.portal.cardiol.br', newsPageUrl: 'https://portal.cardiol.br/noticias', category: mapCategory('Sociedade'), language: mapLanguage('Brasil'), specialty: 'clinica_medica', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'Sociedade Brasileira de Infectologia', url: 'https://infectologia.org.br', newsPageUrl: 'https://infectologia.org.br/noticias', category: mapCategory('Sociedade'), language: mapLanguage('Brasil'), specialty: 'clinica_medica', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'SBIm', url: 'https://sbim.org.br', newsPageUrl: 'https://sbim.org.br/noticias', category: mapCategory('Sociedade'), language: mapLanguage('Brasil'), specialty: 'preventiva', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'Sociedade Brasileira de Pediatria', url: 'https://www.sbp.com.br', newsPageUrl: 'https://www.sbp.com.br/noticias/', category: mapCategory('Sociedade'), language: mapLanguage('Brasil'), specialty: 'pediatria', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'FEBRASGO', url: 'https://www.febrasgo.org.br', newsPageUrl: 'https://www.febrasgo.org.br/noticias', category: mapCategory('Sociedade'), language: mapLanguage('Brasil'), specialty: 'gineco', priority: 'P1', method: 'html', country: 'Brasil' },
  { name: 'SBMFC', url: 'https://www.sbmfc.org.br', newsPageUrl: 'https://www.sbmfc.org.br/noticias', category: mapCategory('Sociedade'), language: mapLanguage('Brasil'), specialty: 'preventiva', priority: 'P1', method: 'html', country: 'Brasil' },

  { name: 'FIOCRUZ', url: 'https://portal.fiocruz.br', category: mapCategory('Pesquisa'), language: mapLanguage('Brasil'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'Brasil' },
  { name: 'SciELO', url: 'https://preprints.scielo.org', category: mapCategory('Pesquisa'), language: mapLanguage('Brasil'), specialty: 'outras', priority: 'P1', method: 'rss', country: 'Brasil' },
  { name: 'OPAS/OMS Brasil', url: 'https://www.paho.org/pt', category: mapCategory('Noticias'), language: mapLanguage('Brasil'), specialty: 'preventiva', priority: 'P1', method: 'rss', country: 'Brasil' },
  { name: 'EBSERH', url: 'https://www.gov.br/ebserh/pt-br', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P1', method: 'rss', country: 'Brasil' },

  { name: 'AHA Cardiology', url: 'https://newsroom.heart.org', category: mapCategory('Sociedade'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'ACC Cardiology', url: 'https://www.acc.org/latest-in-cardiology', category: mapCategory('Sociedade'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'SBC Cardiologia', url: 'https://www.portal.cardiol.br', category: mapCategory('Sociedade'), language: mapLanguage('Brasil'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'Brasil' },
  { name: 'SBEM Endocrinologia', url: 'https://www.endocrino.org.br', category: mapCategory('Sociedade'), language: mapLanguage('Brasil'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'Brasil' },

  { name: 'Journal of the American College of Cardiology', url: 'https://www.jacc.org', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'Circulation', url: 'https://www.ahajournals.org/journal/circ', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'EUA' },
  { name: 'Journal of Clinical Oncology', url: 'https://ascopubs.org/journal/jco', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'cirurgia', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Journal of the National Cancer Institute', url: 'https://academic.oup.com/jnci', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'cirurgia', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Cancer', url: 'https://acsjournals.onlinelibrary.wiley.com/journal/10970142', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'cirurgia', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'JAMA Oncology', url: 'https://jamanetwork.com/journals/jamaoncology', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'cirurgia', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Brain', url: 'https://academic.oup.com/brain', category: mapCategory('Jornal'), language: mapLanguage('Reino Unido'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'Reino Unido' },
  { name: 'JAMA Neurology', url: 'https://jamanetwork.com/journals/jamaneurology', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Annals of Neurology', url: 'https://onlinelibrary.wiley.com/journal/15318249', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Journal of Infectious Diseases', url: 'https://academic.oup.com/jid', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Clinical Infectious Diseases', url: 'https://academic.oup.com/cid', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Lancet Infectious Diseases', url: 'https://www.thelancet.com/journals/laninf/issue/current', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'clinica_medica', priority: 'P1', method: 'rss', country: 'Global' },
  { name: 'American Journal of Respiratory and Critical Care Medicine', url: 'https://www.atsjournals.org/journal/ajrccm', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'European Respiratory Journal', url: 'https://erj.ersjournals.com', category: mapCategory('Jornal'), language: mapLanguage('UE'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'UE' },
  { name: 'Thorax', url: 'https://thorax.bmj.com', category: mapCategory('Jornal'), language: mapLanguage('Reino Unido'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'Reino Unido' },
  { name: 'Diabetes Care', url: 'https://diabetesjournals.org/care', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'JCEM', url: 'https://academic.oup.com/jcem', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Gut', url: 'https://gut.bmj.com', category: mapCategory('Jornal'), language: mapLanguage('Reino Unido'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'Reino Unido' },
  { name: 'Gastroenterology', url: 'https://www.gastrojournal.org', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Hepatology', url: 'https://journals.lww.com/hep', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P3', method: 'rss', country: 'EUA' },
  { name: 'Arthritis & Rheumatology', url: 'https://acrjournals.onlinelibrary.wiley.com/journal/23265205', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P3', method: 'rss', country: 'EUA' },
  { name: 'JAAD', url: 'https://www.jaad.org', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P3', method: 'rss', country: 'EUA' },
  { name: 'Obstetrics & Gynecology', url: 'https://journals.lww.com/greenjournal', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'gineco', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Pediatrics', url: 'https://publications.aap.org/pediatrics', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'pediatria', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Neurology', url: 'https://www.neurology.org', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'JCO', url: 'https://ascopubs.org/journal/jco', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'cirurgia', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Journal of Clinical Investigation', url: 'https://www.jci.org', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'outras', priority: 'P3', method: 'rss', country: 'EUA' },
  { name: 'AJKD', url: 'https://www.ajkd.org', category: mapCategory('Jornal'), language: mapLanguage('EUA'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'EUA' },
  { name: 'Kidney International', url: 'https://www.kidney-international.org', category: mapCategory('Jornal'), language: mapLanguage('Global'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'Global' },

  { name: 'Whitebook Blog', url: 'https://whitebook.pebmed.com.br/blog', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'PEBMED', url: 'https://pebmed.com.br', category: mapCategory('Noticias'), language: mapLanguage('Brasil'), specialty: 'clinica_medica', priority: 'P2', method: 'rss', country: 'Brasil' },
  { name: 'Medway Residência', url: 'https://www.medway.com.br/conteudos/residencia-medica', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'Estratégia MED', url: 'https://med.estrategia.com/portal', newsPageUrl: 'https://med.estrategia.com/portal/blog', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'Sanar Medicina', url: 'https://www.sanarmed.com', newsPageUrl: 'https://www.sanarmed.com/blog', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P3', method: 'html', country: 'Brasil' },
  { name: 'Jaleko', url: 'https://jaleko.com.br', newsPageUrl: 'https://jaleko.com.br/blog', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P3', method: 'html', country: 'Brasil' },
  { name: 'HC FMUSP', url: 'https://www.hc.fm.usp.br', newsPageUrl: 'https://www.hc.fm.usp.br/hc/noticias', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'UNIFESP', url: 'https://www.unifesp.br', newsPageUrl: 'https://www.unifesp.br/noticias-anteriores', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'UNICAMP', url: 'https://www.unicamp.br', newsPageUrl: 'https://www.unicamp.br/unicamp/noticias', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'UFRJ', url: 'https://ufrj.br', newsPageUrl: 'https://ufrj.br/noticias', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'UFMG', url: 'https://ufmg.br', newsPageUrl: 'https://ufmg.br/comunicacao/noticias', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'UFRGS', url: 'https://www.ufrgs.br', newsPageUrl: 'https://www.ufrgs.br/noticias', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'USP Ribeirão / FMRP', url: 'https://www.fmrp.usp.br', newsPageUrl: 'https://www.fmrp.usp.br/noticias/', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'UFPR', url: 'https://www.ufpr.br', newsPageUrl: 'https://www.ufpr.br/portalufpr/noticias/', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'UFSC', url: 'https://ufsc.br', newsPageUrl: 'https://noticias.ufsc.br/', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
  { name: 'UFPE', url: 'https://www.ufpe.br', newsPageUrl: 'https://www.ufpe.br/noticias', category: mapCategory('Residencia'), language: mapLanguage('Brasil'), specialty: 'residencia', priority: 'P2', method: 'html', country: 'Brasil' },
];

async function main(): Promise<void> {
  await mongoose.connect(env.MONGOURI);
  console.log('[seedMedNewsSources] Connected to MongoDB');
  console.log(`[seedMedNewsSources] Seeding ${SOURCES.length} sources...`);

  let created = 0;
  let skipped = 0;

  for (const entry of SOURCES) {
    const existing = await MedNewsSource.exists({ url: entry.url });
    if (existing) { skipped++; continue; }

    await MedNewsSource.create({
      ...entry,
      ...(entry.newsPageUrl && { newsPageUrl: entry.newsPageUrl }),
    });
    created++;
  }

  console.log(`\n[seedMedNewsSources] Done.`);
  console.log(`  created : ${created}`);
  console.log(`  skipped : ${skipped} (already existed)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[seedMedNewsSources] Fatal error:', err);
  process.exit(1);
});
