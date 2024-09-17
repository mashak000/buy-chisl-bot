const { Bot, session, InlineKeyboard } = require("grammy");
require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { authorize } = require("./auth");

const bot = new Bot(process.env.BOT_TOKEN);

const auth = authorize();
const drive = google.drive({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });

const deliveryOptions = {
  courier: {
    price: 500,
    description: "Delivery by courier",
  },
  post: {
    price: 400,
    description: "Russian Post",
  },
  pickup: {
    price: 0,
    description: "Pickup",
  },
};

const getInvoice = (id, usersAmount) => {
  const invoice = {
    title: "Численничек 2023",
    description: "⚠️Обратите внимание, календарь на 2023 год⚠️",
    currency: "RUB",
    prices: [{ label: "Численничек 2023", amount: 100 * usersAmount }],
    payload: JSON.stringify({
      unique_id: `${id}_${Number(new Date())}`,
      provider_token: process.env.PROVIDER_TOKEN,
    }),
  };
  return JSON.parse(JSON.stringify(invoice));
};

const amountStep = (ctx) => {
  ctx.reply(`Введите количество календарей`);
  ctx.session.step = "amount";
};

const valueStep = (ctx) => {
  ctx.reply("Введите сумму доната не менее 500 рублей (только число)");
  ctx.session.step = "payment";
};

const paymentStep = async (ctx) => {
  const usersAmount = parseInt(ctx.msg.text, 10) * parseInt(ctx.session.amount);

  if (isNaN(usersAmount) || usersAmount < 500 || parseInt(ctx.msg.text, 10) < 500) {
    await ctx.reply("Пожалуйста, введите сумму не менее 500");
  } else {
    const totalAmount =
      deliveryOptions[ctx.session.delivery].price + usersAmount;
    const invoice = getInvoice(ctx.chat.id, totalAmount);
    try {
      await axios.post(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendInvoice`,
        {
          chat_id: ctx.chat.id,
          title: invoice.title,
          description: invoice.description,
          currency: invoice.currency,
          prices: invoice.prices,
          payload: invoice.payload,
          provider_token: process.env.PROVIDER_TOKEN,
          start_parameter: "get_access",
        }
      );
      ctx.session.step = null;
    } catch (error) {
      console.error(
        "Error sending invoice:",
        error.response ? error.response.data : error.message
      );
    }
  }
};

// нужен для хранения сессии заявки мидлвара
bot.use(
  session({
    initial: () => ({
      step: null, // Track the current step
      delivery: null,
      formData: {}, // Store the user input
    }),
  })
);

// создаем отдельную папку
async function createFolder(folderName) {
  try {
    const fileMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID], // ID родительской папки
    };
    const response = await drive.files.create({
      resource: fileMetadata,
      fields: "id",
    });
    console.log("Folder created on Google Drive, ID:", response.data.id);
    return response.data.id; // Возвращаем ID созданной папки
  } catch (error) {
    console.error("Error creating folder on Google Drive:", error);
    throw new Error("Failed to create folder on Google Drive");
  }
}

// загружает на Google Drive
async function uploadFile(filePath, fileName, folderId) {
  try {
    const fileMetadata = {
      name: fileName,
      parents: [folderId],
    };
    const media = {
      mimeType: "application/octet-stream",
      body: fs.createReadStream(filePath),
    };
    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });
    console.log("File uploaded to Google Drive, ID:", response.data.id);
    return response.data.id;
  } catch (error) {
    console.error("Error uploading file to Google Drive:", error);
    throw new Error("Failed to upload file to Google Drive");
  }
}

// Основная функция для создания папки и загрузки файлов
async function uploadFilesToNewFolder(folderName, files) {
  try {
    // Создаем новую папку внутри существующей
    const newFolderId = await createFolder(folderName);

    // Загружаем файлы в новую папку
    for (const file of files) {
      await uploadFile(file.filePath, file.fileName, newFolderId);
    }

    console.log("All files uploaded successfully.");
    return newFolderId;
  } catch (error) {
    console.error("Error in uploading files to new folder:");
  }
}

// добавляет строку в гугл таблицу
async function appendToSheet(values) {
  const resource = {
    values: [values],
  };
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "aplication!A1",
    valueInputOption: "USER_ENTERED",
    resource: resource,
  });
}

bot.command("help", async (ctx) => {
  ctx.reply(
    "Если у вас возникли трудности с оформлением покупки или отправки заявки на опенколл, попробуйте очистить историю диалога и заполнить информацию еще раз, если и это не помогло, напишите @mashak000"
  );
});

bot.command("start", async (ctx) => {
  const markdownMessage = `
<b>Привет, ${ctx.from.first_name}!</b>

<b>collective_ism</b> — независимое кураторское объединение создательниц Численничка. Мы занимаемся теорией и практикой современного искусства, а наши интересы лежат на стыке критического, визуального, смешного и простого.

Следите за нашей работой в канале <a href="https://t.me/collective_ism">collective_ism</a> или в <a href="https://www.instagram.com/collective_ism/">инстаграме</a>.

<b>Численничек</b> — это проект отрывного календаря, составленного из 365 работ разных авторов. Проект был запущен в 2019 году и приостановлен в 2024. За пять лет мы провели пять опен-коллов, отобрали более 1,5 тысяч работ и напечатали 5 выпусков календаря. Численничек 2023 — последний выпуск календаря на сегодняшний день — посвящен феномену шифра, сокрытию, утаиванию и иносказанию.

Подробности о Численничке и нашей художественной практике читайте в <a href="https://obdn.ru/articles/chislennichek">журнале «Объединение»</a> или слушайте наш <a href="https://garagemca.org/event/public-talk-from-chislennichek-to-collective-writing">артист-ток</a>, состоявшийся год назад в Музее современного искусства «Гараж».

Возникли проблемы? Отправьте /help`;

  try {
    const keyboard = new InlineKeyboard()
      .text("📆 last sale численничек 📆", "buy")
      .row()
      .text("📬 Участвовать в опен колле 📬", "apply");

    await ctx.reply(markdownMessage, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.error("Error sending the message:", error);
    ctx.reply(
      "Произошла ошибка при отправке сообщения. Пожалуйста, попробуйте снова."
    );
  }
});

// логика покупки
bot.callbackQuery("buy", async (ctx) => {
  try {
    const keyboard = new InlineKeyboard().text("Купить", "start_buy")
    await ctx.api.sendMediaGroup(ctx.chat.id, [
      { type: "photo", media: "https://imgur.com/49W6H4W" },
      { type: "photo", media: "https://imgur.com/srzaUGt" },
    ]);
    await ctx.reply(
      `<b>Заберите себе экземпляр последнего выпуска Численничка за донат от 500р!</b>

Темой Численничка 2023 стала аббревиатура Э.Н.И.Г.М.А. (Это Название Использует Гарантии Молчания Аббревиатуры). Юбилейный пятый и последний Численничек был посвящен шифрам, кодам, знакам и всем возможным способам их использования и осмысления. Шифр видится главной действующей силой искусства: героя и автора нет, остались бесконечные лабиринты из знаков, кодов и отсылок. 

Внутри:

- 365 работ художников и авторов
- Крепление, позволяющее повесить календарь или разместить на горизонтальной поверхности
- На обороте каждого листа-дня размещена экспликация, написанная автором работы
- 380 страниц, 8 Х 14,5 см, цветная двусторонняя офсетная печать (4+1)
      `,
      {
        parse_mode: "HTML",
        reply_markup: keyboard,
      }
    );
  } catch (error) {
    console.log(error);
  }
});

bot.callbackQuery("start_buy", (ctx) => {
  amountStep(ctx);
})

bot.callbackQuery("curier", async (ctx) => {
  ctx.session.delivery = "courier";
  await ctx.reply(
    "Пожалуйста, пришлите адрес доставки, а также контактный номер телефона"
  );
  ctx.session.step = "delivery";
});

bot.callbackQuery("post", async (ctx) => {
  ctx.session.delivery = "post";
  await ctx.reply(
    "Пожалуйста, пришлите адрес доставки, индекс, ФИО получателя, а также контактный номер телефона"
  );
  ctx.session.step = "delivery";
});

bot.callbackQuery("pickup", async (ctx) => {
  ctx.session.delivery = "pickup";
  valueStep(ctx);
});

bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on("message:successful_payment", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .url("Телеграм канал collective(ism)", "https://t.me/collective_ism")
    .row()
    .text("Опен колл", "apply");
  await ctx.reply(
    "<b>Спасибо, платеж прошел успешно! Мы скоро свяжемся с Вами</b>",
    {
      reply_markup: keyboard,
      parse_mode: "HTML",
    }
  );

  const deliveryData = ctx.session.deliveryData || "Выбран самовывоз";
  const username = ctx.from.username;

  const combinedData = `Девачки, пришел новый заказ💅💅💅\nИнформация по доставке: ${deliveryData}\nПользователь: @${username}\nКоличество: ${ctx.session.amount}`;

  await bot.api.sendMessage(process.env.CHAT_ID, combinedData);

  delete ctx.session.delivery;
  delete ctx.session.deliveryData;
});

// логика по опен коллу
bot.callbackQuery("apply", async (ctx) => {
  ctx.answerCallbackQuery();

  ctx.session.step = "curatorText";

  const keyboard = new InlineKeyboard()
    .text("Условия участия", "rules")
    .row()
    .text("Заполнить заявку", "start_apply");

  const message = `
  <b>«Если интернет отключат завтра, что вы возьмете с собой?»</b>

Обещания безграничной свободы и автономности эпохи раннего интернета не оправдались. Своим пионерам интернет виделся способом противопоставить себя контролю со стороны, например, государства или корпораций, однако разочарование случилось достаточно быстро. В онлайн, как и в оффлайн пространстве, есть границы, но также — серые зоны и слепые пятна. С каждым годом происходящее в интернете всё сильнее влияет на реальную жизнь. Если вам не посчастливилось жить в условиях цензуры и репрессий, то вы знаете, что в интернете порой не стоит оставлять следы.

Пространство интернета не оказалось безграничным и в контексте хранения информации: место на облаке, жестком диске или флешке неминуемо заканчивается. Однако сбор и хранение информации теперь осуществляются по-разному: можно довольствоваться папками на рабочем столе, можно переносить все на жесткие диски, а также выстраивать баланс между материальным и диджитал архивом.

Как появление интернета и последующее разочарование в нем могут повлиять на то, как сохраняется память, и то, как собираются коллекции? Материальное хранение — семейные альбомы, дневники, записные книжки, многое другое — ограничено пространством и хрупкостью своих объектов, в то время, как ведение диджитал архива не всегда безопасно. Наконец, с внушительной коллекцией сложно быть на ходу и в движении — материальное тяготит и привязывает к конкретному месту. 

В контексте происходящего последние несколько лет назревает вопрос: как организовать хранение, если интернет отключат? Если наступит апокалипсис? Где коллекция будет в большей безопасности — оффлайн или онлайн, в материальном или диджитал виде? Свобода перемещения заставляет склоняться в пользу последнего: жесткий диск со снимками 10 тысяч ракушек удобней коллекции из 10 тысяч ракушек.

Например, наша коллекция — остаток тиража Численничка 2023 — скоро выселит нас из квартиры: непросто делить двухкомнатное пространство с Х коробок с Х экземплярами календаря. В свете грядущего переезда мы задумались о том, как возможно собирательство в принципе в условиях ограничений. И как организованы коллекции других?
  `;

  try {
    await ctx.api.sendMediaGroup(ctx.chat.id, [
      { type: "photo", media: "https://imgur.com/nkPaI1l" },
      { type: "photo", media: "https://imgur.com/uV0vFJ9" },
    ]);
    ctx.reply(message, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  } catch (error) {
    console.log(error);
  }
});

bot.callbackQuery("rules", (ctx) => {
  const keyboard = new InlineKeyboard().text("Заполнить заявку", "start_apply");

  const text = `<b>Условия участия:</b>

- работа, осмысляющая заданную тему
- любой медиум (адаптированный под диджитал формат)
- до 10 единиц
- выбранные работы будут опубликованы в канале <a href="https://t.me/collective_ism">collective_ism</a>
- сбор работ до 31 октября`;

  ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
});

bot.callbackQuery("start_apply", (ctx) => {
  ctx.answerCallbackQuery();
  ctx.session.step = "bioInfo";
  ctx.reply("Как вас зовут?");
});

// создает ссылку для файла на гугл диске
async function getShareableFolderLink(fileId) {
  try {
    // First, create permission to make the folder shareable
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    // Fetch the folder metadata to get the webViewLink
    const folder = await drive.files.get({
      fileId: fileId,
      fields: "webViewLink",
    });

    return folder.data.webViewLink;
  } catch (error) {
    console.error("Error generating shareable folder link:");
    throw error;
  }
}

bot.callbackQuery("saveAndSend", async (ctx) => {
  const session = ctx.session;

  ctx.answerCallbackQuery();
  ctx.reply("💽 сохраняем информацию, это может занять какое-то время");
  if (session.formData.files && session.formData.files.length > 0) {
    try {
      const newFolderId = await uploadFilesToNewFolder(
        session.formData.name,
        session.formData.files
      );
      for (const file of session.formData.files) {
        try {
          fs.unlink(file.filePath, (err) => {
            if (err) {
              console.error(`Error deleting file ${file.filePath}:`, err);
            } else {
              console.log(`Deleted local file ${file.filePath}`);
            }
          });
        } catch (error) {
          console.error(
            `Failed to upload or delete file ${file.fileName}:`,
            error
          );
        }
      }
      const shareableLink = await getShareableFolderLink(newFolderId);

      const values = [];
      for (let key in session.formData) {
        if (key === "username") {
          const userProfileLink = session.formData.username
            ? `=HYPERLINK("https://t.me/${session.formData.username}")`
            : "No username";
          values.push(userProfileLink);
        } else if (key !== "files") {
          values.push(session.formData[key]);
        } else {
          values.push(`=HYPERLINK("${shareableLink}")`);
        }
      }
      await appendToSheet(values);
      session.step = "finalStep";
      const keyboard = new InlineKeyboard()
        .url("Телеграм канал collective(ism)", "https://t.me/collective_ism")
        .row()
        .text("Купить Численничек 2023", "buy");
      ctx.reply(
        "<b>Готово! Спасибо за заявку, ответим в начале ноября</b>",
        {
          parse_mode: "HTML",
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      // console.error(`Failed to upload sheet`, error);
      console.error(`Failed to upload sheet`);
    }
    session.step = "finalStep";
  } else {
    ctx.reply("Вы не загрузили ни одного файла.");
  }
});

async function showEditMenu(ctx) {
  const keyboard = new InlineKeyboard()
    .text("Имя", "editBio")
    .text("Ссылка на соцсеть", "editSocialMedia")
    .row()
    .text("Название", "editNameOfArt")
    .text("Описание", "editDesc")
    .row()
    .text("Загрузить файлы заново", "editFiles")
    .row()
    .text("Сохранить и отправить", "saveAndSend");
  const allInfo = `Имя: ${ctx.session.formData.name}\nСсылка на соцсеть: ${ctx.session.formData.socialMedia}\nНазвание работы: ${ctx.session.formData.nameofart}\nОписание: ${ctx.session.formData.description}\nЗагружено файлов: ${ctx.session.formData.files.length}`;
  await ctx.reply(`${allInfo}\n\n Выберите, что нужно отредактировать:`, {
    reply_markup: keyboard,
  });
}

bot.callbackQuery("edit", async (ctx) => {
  ctx.answerCallbackQuery();
  await showEditMenu(ctx);
});

bot.callbackQuery("editBio", async (ctx) => {
  ctx.session.step = "bioInfo";
  ctx.reply("Как вас зовут?");
});

bot.callbackQuery("editSocialMedia", async (ctx) => {
  ctx.session.step = "socialMedia";
  ctx.reply("Ссылка на ваши социальные сети");
});

bot.callbackQuery("editNameOfAr", (ctx) => {
  ctx.session.step = "nameOfArt";
  ctx.reply("Название работы");
});

bot.callbackQuery("editDesc", async (ctx) => {
  ctx.session.step = "collectDescription";
  ctx.reply("Описание работы");
});

bot.callbackQuery("editFiles", async (ctx) => {
  ctx.session.step = "collectFile";
  ctx.session.formData.files = [];
  ctx.reply("Отправьте до 10 файлов с вашей работой.");
});

bot.callbackQuery("confirmSubmission", async (ctx) => {
  const session = ctx.session;

  ctx.answerCallbackQuery();
  if (session.formData.files && session.formData.files.length > 0) {
    await ctx.reply("Файлы были успешно сохранены");
    const keyboard = new InlineKeyboard()
      .text("Редактировать", "edit")
      .text("Сохранить и отправить", "saveAndSend");
    const allInfo = `Имя: ${session.formData.name}\nсылка на соцсеть: ${ctx.session.formData.socialMedia}\nНазвание работы: ${ctx.session.formData.nameofart}\nОписание работы: ${session.formData.description}\nЗагружено файлов: ${session.formData.files.length} \n\nНажимая отправить вы соглашаетесь на предоставление информации организаторам опенколла.`;
    ctx.reply(allInfo, {
      reply_markup: keyboard,
    });
  } else {
    ctx.reply("Вы не загрузили ни одного файла.");
    session.step = "collectFile";
  }
});

bot.on("message", async (ctx) => {
  const session = ctx.session;

  // logic for buying
  if (session.step === "payment") {
    await paymentStep(ctx);
  } else if (session.step === "amount") {
    ctx.session.amount = ctx.message.text;
    const keyboard = new InlineKeyboard()
      .text("Курьером (по Москве) — 500р.", "curier")
      .row()
      .text("Почта России — 400р.", "post")
      .row()
      .text("Самовывоз (метро ул. 1905 года)", "pickup");

    await ctx.reply("Выберите способ доставки👇", {
      reply_markup: keyboard,
    });
  } else if (session.step === "delivery") {
    session.deliveryData = ctx.msg.text;
    await ctx.reply("<b>Спасибо, мы сохранили информацию о доставке</b>", {
      parse_mode: "HTML",
    });
    valueStep(ctx);
  }

  //logic for open call
  if (session.step === "bioInfo") {
    session.formData.name = ctx.message.text;
    session.formData.username = ctx.message.from.username;
    if (!session.formData.socialMedia) {
      ctx.reply("Пришлите ссылку на вашу соцсеть");
      session.step = "socialMedia";
    } else {
      showEditMenu(ctx);
    }
  } else if (session.step === "socialMedia") {
    session.formData.socialMedia = ctx.message.text;
    if (!session.formData.nameofart) {
      ctx.reply("Название работы");
      session.step = "nameOfArt";
    } else {
      showEditMenu(ctx);
    }
  } else if (session.step === "nameOfArt") {
    session.formData.nameofart = ctx.message.text;
    if (!session.formData.description) {
      ctx.reply("Описание");
      session.step = "collectDescription";
    } else {
      showEditMenu(ctx);
    }
  } else if (session.step === "collectDescription") {
    session.formData.description = ctx.message.text;
    if (!session.formData.files) {
      ctx.reply("Отправьте до 10 файлов с вашей работой.");
      session.step = "collectFile";
    } else {
      showEditMenu(ctx);
    }
  } else if (session.step === "collectFile") {
    const keyboard = new InlineKeyboard().text("Готово", "confirmSubmission");

    if (!session.formData.files) {
      session.formData.files = [];
    }

    if (!session.mediaGroupTimeout) {
      session.mediaGroupTimeout = null;
    }

    const files = [];

    try {
      if (ctx.message.document) {
        files.push(ctx.message.document);
      } else if (ctx.message.photo) {
        files.push(ctx.message.photo[ctx.message.photo.length - 1]);
      } else if (ctx.message.video) {
        files.push(ctx.message.video);
      } else if (ctx.message.audio) {
        files.push(ctx.message.audio);
      } else if (ctx.message.voice) {
        files.push(ctx.message.voice);
      } else {
        // Unsupported file type
        throw new Error("Unsupported file format.");
      }

      for (const fileObject of files) {
        const fileId = fileObject.file_id;
        const file = await ctx.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        const fileName = ctx.message.document
          ? ctx.message.document.file_name
          : ctx.message.photo
          ? `photo_${Date.now()}.jpg`
          : ctx.message.video
          ? `video_${Date.now()}.mp4`
          : ctx.message.audio
          ? `audio_${Date.now()}.mp3`
          : ctx.message.voice
          ? `voice_${Date.now()}.ogg`
          : `file_${Date.now()}`;

        const filePath = path.join(__dirname, fileName);

        const response = await axios({
          url: fileUrl,
          method: "GET",
          responseType: "stream",
        });

        response.data.pipe(fs.createWriteStream(filePath));
        await new Promise((resolve) => response.data.on("end", resolve));

        session.formData.files.push({
          filePath: filePath,
          fileName: fileName,
        });

        if (session.formData.files.length >= 10) {
          ctx.reply("Вы загрузили максимальное количество файлов", {
            reply_markup: keyboard,
          });
          return;
        }
      }

      // Clear any existing timeout to wait for more files
      if (session.mediaGroupTimeout) {
        clearTimeout(session.mediaGroupTimeout);
      }

      // Set a timeout to detect when no more files are arriving
      session.mediaGroupTimeout = setTimeout(async () => {
        ctx.reply(
          `Вы загрузили ${session.formData.files.length} файл${
            parseInt(session.formData.files.length) === 1
              ? ""
              : [2, 3, 4].includes(parseInt(session.formData.files.length))
              ? "a"
              : "ов"
          }. Вы можете отправить еще ${10 - session.formData.files.length}.`,
          {
            reply_markup: keyboard,
          }
        );
        session.mediaGroupTimeout = null;
      }, 1000);
    } catch (error) {
      console.error("Error processing files:", error.message);
      ctx.reply(
        "Произошла ошибка при загрузке. Пожалуйста, отправьте файл в поддерживаемом формате."
      );
    }
  }

  // if (session.step === "finalStep") {
  //   ctx.reply("Спасибо за заявку, ответим в первой неделе ноября");
  // }
});

bot.start();
