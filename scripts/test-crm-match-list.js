/**
 * Юнит-тесты сверки списка с CRM (без живого Bitrix).
 * Запуск: npm run test:crm-match-list
 */
import {
  parseMatchItems,
  normalizeMatchText,
  scoreNames,
  scorePersonNames,
  scoreCompanyNames,
  extractInn,
  matchQueriesToDirectory,
  formatMatchListForLlm,
  MATCH_LIST_KIND,
  applyAttachmentTextToMatchParams,
  extractListTextFromUserMessage,
  isPlaceholderListText,
  buildMatchListCard,
} from "../src/actions/crmMatchList.js";
import { getActionHandler } from "../src/actions/index.js";
import { getActionPolicy } from "../src/safety/policies.js";

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

function main() {
  console.log("\n[test:crm-match-list]\n");

  assert(normalizeMatchText('ООО "Ромашка"') === "ромашка", "1. Нормализация убирает ООО и кавычки");
  assert(scoreNames("ООО Ромашка", "Ромашка") >= 0.92, "2. ООО Ромашка = Ромашка");
  assert(scoreNames("Иванов Иван", "Иванов Иван Петрович") >= 0.55, "3. ФИО с отчеством — похоже");

  const parsed = parseMatchItems({
    text: "Компания\tФИО\nООО Ромашка\tИванов Иван\nTwiga\tПетров Пётр",
  });
  assert(parsed.length === 2 && parsed[0].companyQuery.includes("Ромашка"), "4. Заголовок пропускается, две колонки разбираются");
  assert(parsed[0].personQuery.includes("Иванов"), "5. ФИО во второй колонке");

  const rows = matchQueriesToDirectory(parsed, {
    companies: [{ ID: 10, TITLE: "Ромашка" }],
    contacts: [
      { ID: 20, NAME: "Иван", LAST_NAME: "Иванов" },
      { ID: 21, NAME: "Пётр", LAST_NAME: "Петров" },
    ],
  });
  assert(rows[0].status === "found" && rows[0].company?.id === 10, "6. Компания найдена");
  assert(rows[0].contact?.id === 20, "7. Контакт найден");
  assert(rows[1].status === "similar" && rows[1].contact?.id === 21, "8. Контакт есть, компании Twiga нет — не «найдено»");

  const missing = matchQueriesToDirectory(
    [{ line: 1, input: "Неттакойфирмы", companyQuery: "Неттакойфирмы", personQuery: "" }],
    { companies: [{ ID: 1, TITLE: "Ромашка" }], contacts: [] }
  );
  assert(missing[0].status === "not_found", "9. Нет в CRM");

  const policy = getActionPolicy("crm_match_list");
  assert(policy?.access === "read" && policy?.requiresConfirmation === false, "10. Чтение без подтверждения");
  assert(typeof getActionHandler("crm_match_list") === "function", "11. Handler зарегистрирован");
  assert(getActionHandler("crm_duplicate_search") === getActionHandler("crm_match_list"), "12. Алиас crm_duplicate_search");

  const llm = formatMatchListForLlm({
    kind: MATCH_LIST_KIND,
    summary: { total: 2, found: 1, similar: 0, notFound: 1 },
    rows,
    directory: { companies: 1, contacts: 2, truncated: false },
  });
  assert(llm.includes("Контактов найдено: 1") && /подтверждение не требуется/i.test(llm), "13. Текст для модели без подтверждения");

  const empty = parseMatchItems({ text: "" });
  assert(empty.length === 0, "14. Пустой текст");

  const filled = applyAttachmentTextToMatchParams("crm_match_list", {}, "ООО Ромашка\tИванов Иван\nTwiga\tПетров Пётр");
  assert(parseMatchItems(filled).length === 2, "15. Пустые params заполняются текстом вложения");
  const placeholder = applyAttachmentTextToMatchParams("crm_match_list", { text: "см. вложение" }, "A\tB\nC\tD");
  assert(placeholder.text.startsWith("A"), "16. Заглушка «см. вложение» заменяется файлом");
  const keep = applyAttachmentTextToMatchParams("crm_match_list", { text: "Компания\tФИО\nРомашка\tИванов" }, "ignore");
  assert(keep.text.includes("Ромашка"), "17. Явно переданный список не затирается");
  assert(applyAttachmentTextToMatchParams("contact_list", {}, "x").text == null, "18. В другие actions текст не подставляется");
  assert(isPlaceholderListText(""), "19. Пустая строка — заглушка");
  const fromMsg = extractListTextFromUserMessage(
    "Проверь\n\n---\nПрикреплённые файлы\nинструкция\n\n### Файл: list.xlsx (2 строк)\nООО Ромашка\tИванов"
  );
  assert(fromMsg.includes("ООО Ромашка"), "20. Текст списка извлекается из сообщения с вложением");

  const card = buildMatchListCard({
    summary: { total: 1, found: 1, similar: 0, notFound: 0 },
    rows: [
      {
        line: 1,
        input: "1С | Борис Нуралиев",
        companyQuery: "1С",
        personQuery: "Борис Нуралиев",
        status: "found",
        company: { id: 10, title: 'АО "1С"' },
        contact: { id: 20, title: "Нуралиев Борис Георгиевич" },
      },
    ],
  });
  assert(card.table.columns.includes("Компания") && card.table.columns.includes("ФИО"), "21. Карточка: отдельные колонки компания и ФИО");
  assert(card.table.rows[0][1] === "1С" && card.table.rows[0][2] === "Борис Нуралиев", "22. Список разделён на компанию и ФИО");
  assert(card.table.rows[0][4].includes("1С") && card.table.rows[0][5].includes("Нуралиев"), "23. Bitrix разделён на компанию и ФИО");
  assert(card.download?.contentBase64 && /\.xlsx$/.test(card.download.filename), "24. К карточке приложен Excel для скачивания");

  assert(scorePersonNames("Елена Волкова", "Волкова Елена") >= 0.92, "25. ФИО: имя-фамилия = фамилия-имя");
  assert(scorePersonNames("Елена Волкова", "Волкова Е.Н.") >= 0.85, "26. ФИО: инициалы при той же фамилии");

  const camel = matchQueriesToDirectory(
    [{ line: 1, input: "Северсталь | Елена Волкова", companyQuery: "Северсталь", personQuery: "Елена Волкова" }],
    {
      companies: [{ id: 4, title: 'ПАО "СЕВЕРСТАЛЬ"' }],
      contacts: [{ id: 77, name: "Елена", lastName: "Волкова", companyId: 4 }],
    }
  );
  assert(camel[0].contact?.id === 77 && camel[0].status === "found", "27. Контакт из camelCase-полей crm.item.list");

  const companyOnly = matchQueriesToDirectory(
    [{ line: 1, input: "Северсталь | Елена Волкова", companyQuery: "Северсталь", personQuery: "Елена Волкова" }],
    { companies: [{ ID: 4, TITLE: 'ПАО "СЕВЕРСТАЛЬ"' }], contacts: [] }
  );
  assert(companyOnly[0].status === "company_only" && !companyOnly[0].contact, "28. Компания без ФИО — не «найдено»");

  const initialsAtCompany = matchQueriesToDirectory(
    [{ line: 1, input: "Северсталь | Елена Волкова", companyQuery: "Северсталь", personQuery: "Елена Волкова" }],
    {
      companies: [{ ID: 4, TITLE: 'ПАО "СЕВЕРСТАЛЬ"' }],
      contacts: [{ ID: 9, NAME: "Е", LAST_NAME: "Волкова", COMPANY_ID: 4 }],
    }
  );
  assert(initialsAtCompany[0].contact?.id === 9, "29. В компании находится контакт с инициалом");

  const preferCompanyContact = matchQueriesToDirectory(
    [{ line: 1, input: "Северсталь | Елена Волкова", companyQuery: "Северсталь", personQuery: "Елена Волкова" }],
    {
      companies: [{ ID: 4, TITLE: "Северсталь" }],
      contacts: [
        { ID: 8, NAME: "Елена", LAST_NAME: "Волкова", COMPANY_ID: 99 },
        { ID: 9, NAME: "Елена", LAST_NAME: "Волкова", COMPANY_ID: 4 },
      ],
    }
  );
  assert(preferCompanyContact[0].contact?.id === 9, "30. Предпочитается контакт найденной компании");

  const fullNameOnly = matchQueriesToDirectory(
    [{ line: 1, input: "Елена Волкова", companyQuery: "", personQuery: "Елена Волкова" }],
    { companies: [], contacts: [{ ID: 5, FULL_NAME: "Волкова Елена Николаевна" }] }
  );
  assert(fullNameOnly[0].contact?.id === 5, "31. ФИО из FULL_NAME, если NAME/LAST_NAME пустые");

  assert(
    scorePersonNames("Александр Иванов", "Иванов Игорь Александрович") < 0.55,
    "32. Имя не склеивается с отчеством (Александр ≠ Александрович)"
  );
  assert(
    scoreCompanyNames("НОВАБЕВ ИНФО ТЕХ", 'ООО "ИНФО ТЕХ"') < 0.92 &&
      scoreCompanyNames("НОВАБЕВ ИНФО ТЕХ", 'ООО "ИНФО ТЕХ"') >= 0.55,
    "33. ИНФО ТЕХ не равен НОВАБЕВ ИНФО ТЕХ, но помечается как похожее"
  );
  assert(scoreCompanyNames("Северсталь", 'ПАО "СЕВЕРСТАЛЬ"') >= 0.92, "34. ПАО не мешает точному совпадению компании");

  const wrongPerson = matchQueriesToDirectory(
    [{ line: 15, input: "Бетховен | Александр Иванов", companyQuery: "Бетховен", personQuery: "Александр Иванов" }],
    {
      companies: [{ ID: 1, TITLE: "Ромашка" }],
      contacts: [{ ID: 11323, NAME: "Игорь", LAST_NAME: "Иванов", SECOND_NAME: "Александрович" }],
    }
  );
  assert(
    wrongPerson[0].status === "not_found" && !wrongPerson[0].contact,
    "35. Александр Иванов ≠ Иванов Игорь Александрович"
  );

  const personWithoutCompany = matchQueriesToDirectory(
    [
      {
        line: 19,
        input: "Сантэкс Логистик Груп | Александр Голубев",
        companyQuery: "Сантэкс Логистик Груп",
        personQuery: "Александр Голубев",
      },
    ],
    {
      companies: [{ ID: 50, TITLE: "Другая фирма" }],
      contacts: [{ ID: 2869, NAME: "Александр", LAST_NAME: "Голубев" }],
    }
  );
  assert(
    personWithoutCompany[0].status === "similar" && personWithoutCompany[0].contact?.id === 2869,
    "36. Контакт найден, компании из списка нет — «похоже», не «найдено»"
  );

  const wrongCompany = matchQueriesToDirectory(
    [
      {
        line: 37,
        input: "НОВАБЕВ ИНФО ТЕХ | Андрей Попков",
        companyQuery: "НОВАБЕВ ИНФО ТЕХ",
        personQuery: "Андрей Попков",
      },
    ],
    {
      companies: [{ ID: 10150, TITLE: 'ООО "ИНФО ТЕХ"' }],
      contacts: [{ ID: 4772, NAME: "Андрей", LAST_NAME: "Попков", SECOND_NAME: "Викторович", COMPANY_ID: 10150 }],
    }
  );
  assert(
    wrongCompany[0].status === "similar" && wrongCompany[0].contact?.id === 4772,
    "37. Попков найден, НОВАБЕВ ИНФО ТЕХ ≠ ИНФО ТЕХ — не «найдено»"
  );
  assert(/похожая компания/i.test(wrongCompany[0].note || ""), "37b. Частичное название компании — примечание «похожая»");

  const similarCompanyOnly = matchQueriesToDirectory(
    [{ line: 1, input: "НОВАБЕВ ИНФО ТЕХ", companyQuery: "НОВАБЕВ ИНФО ТЕХ", personQuery: "" }],
    { companies: [{ ID: 10150, TITLE: 'ООО "ИНФО ТЕХ"' }], contacts: [] }
  );
  assert(similarCompanyOnly[0].status === "similar", "37c. Только компания: НОВАБЕВ ИНФО ТЕХ → Похоже, не «нет в CRM»");
  assert(similarCompanyOnly[0].company?.id === 10150, "37d. Похожая компания показывается в колонке Bitrix");

  const ozonTitle = 'ОЗОН / OZON (ООО "ИНТЕРНЕТ РЕШЕНИЯ")';
  assert(scoreCompanyNames("Ozon", ozonTitle) >= 0.92, "38. Ozon = ОЗОН / OZON (юр. название)");
  assert(scoreCompanyNames("Озон", ozonTitle) >= 0.92, "39. Озон латиницей/кириллицей в длинном TITLE");
  assert(extractInn("ИНН 7704217370") === "7704217370", "40. ИНН вытаскивается из текста");

  const ozonRow = matchQueriesToDirectory(
    [{ line: 1, input: "Ozon", companyQuery: "Ozon", personQuery: "", innQuery: "" }],
    {
      companies: [
        {
          ID: 88,
          TITLE: ozonTitle,
          inn: "7704217370",
          legalName: 'ООО "ИНТЕРНЕТ РЕШЕНИЯ"',
        },
      ],
      contacts: [],
    }
  );
  assert(ozonRow[0].status === "found" && ozonRow[0].company?.id === 88, "41. Ozon находится в справочнике");
  assert(ozonRow[0].company?.inn === "7704217370", "42. ИНН из реквизитов попадает в результат");

  const byInn = matchQueriesToDirectory(
    [{ line: 1, input: "7704217370", companyQuery: "неизвестное имя", personQuery: "", innQuery: "7704217370" }],
    { companies: [{ ID: 88, TITLE: ozonTitle, inn: "7704217370" }], contacts: [] }
  );
  assert(byInn[0].status === "found" && byInn[0].company?.id === 88, "43. Совпадение по ИНН, даже если имя в списке другое");

  const parsedInn = parseMatchItems({ text: "Компания\tИНН\nOzon\t7704217370" });
  assert(parsedInn[0]?.companyQuery === "Ozon" && parsedInn[0]?.innQuery === "7704217370", "44. Колонка ИНН разбирается");

  const ozonCard = buildMatchListCard({
    summary: { total: 1, found: 1, similar: 0, notFound: 0, companyOnly: 0 },
    rows: [
      {
        line: 1,
        input: "Ozon",
        companyQuery: "Ozon",
        personQuery: "",
        status: "found",
        company: { id: 88, title: ozonTitle, inn: "7704217370" },
      },
    ],
  });
  assert(ozonCard.table.columns.includes("ИНН") && ozonCard.table.rows[0].includes("7704217370"), "45. В Excel есть колонка ИНН");
  assert(ozonCard.table.columns.includes("Примечание"), "46. В таблице есть колонка «Примечание»");

  console.log(`\n[test:crm-match-list] passed=${passed} failed=${failed}\n`);
  if (failed) process.exit(1);
}

main();
