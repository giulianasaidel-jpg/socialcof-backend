/**
 * Migration — sets the `specialty` field on all existing MedNewsSource documents.
 *
 * Strategy:
 *   1. Apply the known URL → specialty map (covers all seeded sources).
 *   2. Any document still without a specialty gets `'outras'` as fallback.
 *
 * Safe to re-run: uses $set so it is idempotent.
 *
 * Run:
 *   pnpm ts-node-dev --transpile-only --no-notify --watch "" src/scripts/migrateNewsSourceSpecialty.ts
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import { MedNewsSource } from '../models/MedNewsSource';
import { NewsSpecialty } from '../models/MedicalNews';

const URL_SPECIALTY_MAP: Record<string, NewsSpecialty> = {
  'https://pubmed.ncbi.nlm.nih.gov':                                                                    'outras',
  'https://www.ncbi.nlm.nih.gov':                                                                       'outras',
  'https://europepmc.org':                                                                              'outras',
  'https://www.crossref.org':                                                                           'outras',
  'https://clinicaltrials.gov':                                                                         'outras',

  'https://www.who.int/publications':                                                                   'preventiva',
  'https://www.who.int/news-room':                                                                      'preventiva',

  'https://www.nature.com':                                                                             'outras',
  'https://www.sciencedirect.com':                                                                      'outras',
  'https://link.springer.com':                                                                          'outras',
  'https://onlinelibrary.wiley.com':                                                                    'outras',
  'https://www.tandfonline.com':                                                                        'outras',
  'https://www.cell.com':                                                                               'outras',
  'https://www.science.org':                                                                            'outras',
  'https://www.pnas.org':                                                                               'outras',

  'https://www.bmj.com':                                                                                'clinica_medica',
  'https://www.nejm.org':                                                                               'clinica_medica',
  'https://jamanetwork.com':                                                                            'clinica_medica',
  'https://www.thelancet.com':                                                                          'clinica_medica',
  'https://www.acpjournals.org/journal/aim':                                                            'clinica_medica',
  'https://www.cmaj.ca':                                                                                'clinica_medica',
  'https://www.thelancet.com/journals/ebiom':                                                           'clinica_medica',

  'https://www.medrxiv.org':                                                                            'outras',
  'https://www.biorxiv.org':                                                                            'outras',

  'https://www.cochranelibrary.com':                                                                    'clinica_medica',
  'https://www.guidelinecentral.com':                                                                   'clinica_medica',

  'https://www.medscape.com':                                                                           'clinica_medica',
  'https://www.medpagetoday.com':                                                                       'clinica_medica',
  'https://www.statnews.com':                                                                           'outras',
  'https://www.fiercebiotech.com':                                                                      'outras',
  'https://www.fiercehealthcare.com':                                                                   'outras',
  'https://www.healio.com':                                                                             'clinica_medica',
  'https://medicalxpress.com':                                                                          'outras',
  'https://www.news-medical.net':                                                                       'outras',
  'https://www.physicianweekly.com':                                                                    'clinica_medica',
  'https://www.hcplive.com':                                                                            'clinica_medica',
  'https://www.managedhealthcareexecutive.com':                                                         'outras',
  'https://www.mdlinx.com':                                                                             'clinica_medica',
  'https://www.pharmalive.com':                                                                         'outras',
  'https://www.endpts.com':                                                                             'outras',
  'https://www.contemporaryobgyn.net':                                                                  'gineco',
  'https://journals.lww.com/neurotodayonline':                                                          'clinica_medica',
  'https://www.oncologynewscentral.com':                                                                'cirurgia',
  'https://www.infectiousdiseaseadvisor.com':                                                           'clinica_medica',

  'https://www.nice.org.uk/guidance':                                                                   'clinica_medica',
  'https://www.cdc.gov':                                                                                'preventiva',
  'https://www.fda.gov':                                                                                'outras',
  'https://www.ema.europa.eu':                                                                          'outras',
  'https://www.nih.gov':                                                                                'outras',
  'https://www.ahrq.gov':                                                                               'preventiva',
  'https://www.uspreventiveservicestaskforce.org':                                                      'preventiva',
  'https://www.idsociety.org/practice-guideline/idsa-guidelines':                                       'clinica_medica',
  'https://www.acc.org/guidelines':                                                                     'clinica_medica',
  'https://www.escardio.org/Guidelines':                                                                'clinica_medica',
  'https://diabetesjournals.org/care/issue/current':                                                    'clinica_medica',

  'https://portal.cfm.org.br':                                                                         'outras',
  'https://www.gov.br/saude/pt-br':                                                                     'outras',
  'https://www.gov.br/anvisa/pt-br':                                                                    'outras',
  'https://www.gov.br/mec/pt-br/residencia-medica/comissao-nacional-de-residencia-medica':              'residencia',
  'https://www.gov.br/mec/pt-br/residencia-medica/resolucao-residencia-medica':                         'residencia',
  'https://siscnrm.mec.gov.br':                                                                         'residencia',
  'https://portal.cfm.org.br/residencia-medica':                                                        'residencia',
  'https://portal.cfm.org.br/buscar-normas-cfm-e-crm':                                                 'outras',
  'https://www.gov.br/conitec':                                                                         'outras',
  'https://www.gov.br/conitec/pt-br/assuntos/avaliacao-de-tecnologias-em-saude/protocolos-clinicos-e-diretrizes-terapeuticas': 'outras',
  'https://enare.ebserh.gov.br':                                                                        'residencia',
  'https://www.in.gov.br':                                                                              'outras',

  'https://www.portal.cardiol.br':                                                                      'clinica_medica',
  'https://infectologia.org.br':                                                                        'clinica_medica',
  'https://sbim.org.br':                                                                                'preventiva',
  'https://www.sbp.com.br':                                                                             'pediatria',
  'https://www.febrasgo.org.br':                                                                        'gineco',
  'https://www.sbmfc.org.br':                                                                           'preventiva',

  'https://portal.fiocruz.br':                                                                          'outras',
  'https://preprints.scielo.org':                                                                       'outras',
  'https://www.paho.org/pt':                                                                            'preventiva',
  'https://www.gov.br/ebserh/pt-br':                                                                    'residencia',

  'https://newsroom.heart.org':                                                                         'clinica_medica',
  'https://www.acc.org/latest-in-cardiology':                                                           'clinica_medica',
  'https://www.endocrino.org.br':                                                                       'clinica_medica',

  'https://www.jacc.org':                                                                               'clinica_medica',
  'https://www.ahajournals.org/journal/circ':                                                           'clinica_medica',
  'https://ascopubs.org/journal/jco':                                                                   'cirurgia',
  'https://academic.oup.com/jnci':                                                                      'cirurgia',
  'https://acsjournals.onlinelibrary.wiley.com/journal/10970142':                                       'cirurgia',
  'https://jamanetwork.com/journals/jamaoncology':                                                      'cirurgia',
  'https://academic.oup.com/brain':                                                                     'clinica_medica',
  'https://jamanetwork.com/journals/jamaneurology':                                                     'clinica_medica',
  'https://onlinelibrary.wiley.com/journal/15318249':                                                   'clinica_medica',
  'https://academic.oup.com/jid':                                                                       'clinica_medica',
  'https://academic.oup.com/cid':                                                                       'clinica_medica',
  'https://www.thelancet.com/journals/laninf/issue/current':                                            'clinica_medica',
  'https://www.atsjournals.org/journal/ajrccm':                                                         'clinica_medica',
  'https://erj.ersjournals.com':                                                                        'clinica_medica',
  'https://thorax.bmj.com':                                                                             'clinica_medica',
  'https://diabetesjournals.org/care':                                                                  'clinica_medica',
  'https://academic.oup.com/jcem':                                                                      'clinica_medica',
  'https://gut.bmj.com':                                                                                'clinica_medica',
  'https://www.gastrojournal.org':                                                                      'clinica_medica',
  'https://journals.lww.com/hep':                                                                       'clinica_medica',
  'https://acrjournals.onlinelibrary.wiley.com/journal/23265205':                                       'clinica_medica',
  'https://www.jaad.org':                                                                               'outras',
  'https://journals.lww.com/greenjournal':                                                              'gineco',
  'https://publications.aap.org/pediatrics':                                                            'pediatria',
  'https://www.neurology.org':                                                                          'clinica_medica',
  'https://www.jci.org':                                                                                'outras',
  'https://www.ajkd.org':                                                                               'clinica_medica',
  'https://www.kidney-international.org':                                                               'clinica_medica',

  'https://whitebook.pebmed.com.br/blog':                                                               'residencia',
  'https://pebmed.com.br':                                                                              'clinica_medica',
  'https://www.medway.com.br/conteudos/residencia-medica':                                              'residencia',
  'https://med.estrategia.com/portal':                                                                  'residencia',
  'https://www.sanarmed.com':                                                                           'residencia',
  'https://jaleko.com.br':                                                                              'residencia',
  'https://www.hc.fm.usp.br':                                                                          'residencia',
  'https://www.unifesp.br':                                                                             'residencia',
  'https://www.unicamp.br':                                                                             'residencia',
  'https://ufrj.br':                                                                                    'residencia',
  'https://ufmg.br':                                                                                    'residencia',
  'https://www.ufrgs.br':                                                                               'residencia',
  'https://www.fmrp.usp.br':                                                                            'residencia',
  'https://www.ufpr.br':                                                                                'residencia',
  'https://ufsc.br':                                                                                    'residencia',
  'https://www.ufpe.br':                                                                                'residencia',
};

async function main(): Promise<void> {
  await mongoose.connect(env.MONGOURI);
  console.log('[migrateNewsSourceSpecialty] Connected to MongoDB');

  let mapped = 0;
  let fallback = 0;

  for (const [url, specialty] of Object.entries(URL_SPECIALTY_MAP)) {
    const result = await MedNewsSource.updateMany({ url }, { $set: { specialty } });
    if (result.modifiedCount > 0) {
      console.log(`  ✓ ${url} → ${specialty} (${result.modifiedCount} doc)`);
      mapped += result.modifiedCount;
    }
  }

  const fallbackResult = await MedNewsSource.updateMany(
    { specialty: { $exists: false } },
    { $set: { specialty: 'outras' } },
  );
  fallback = fallbackResult.modifiedCount;

  if (fallback > 0) {
    console.log(`  ⚠ ${fallback} documents without a matching URL → set to 'outras'`);
  }

  console.log(`\n[migrateNewsSourceSpecialty] Done.`);
  console.log(`  mapped   : ${mapped}`);
  console.log(`  fallback : ${fallback}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[migrateNewsSourceSpecialty] Fatal error:', err);
  process.exit(1);
});
