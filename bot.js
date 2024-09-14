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
    price: 300,
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
  ctx.reply("Введите количество календарей");
  ctx.session.step = "amount";
};

const valueStep = (ctx) => {
  ctx.session.amount = ctx.message.text;
  ctx.reply("Введите сумму доната (только число, не менее 500)");
  ctx.session.step = "payment";
};

const paymentStep = async (ctx) => {
  const usersAmount = parseInt(ctx.msg.text, 10) * parseInt(ctx.session.amount);

  if (isNaN(usersAmount) || usersAmount < 500) {
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
      mimeType: 'application/vnd.google-apps.folder',
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID], // ID родительской папки
    };
    const response = await drive.files.create({
      resource: fileMetadata,
      fields: 'id',
    });
    console.log('Folder created on Google Drive, ID:', response.data.id);
    return response.data.id; // Возвращаем ID созданной папки
  } catch (error) {
    console.error('Error creating folder on Google Drive:', error);
    throw new Error('Failed to create folder on Google Drive');
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
    
    console.log('All files uploaded successfully.');
    return newFolderId;
  } catch (error) {
    console.error('Error in uploading files to new folder:', error);
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
*Привет, ${ctx.from.first_name}\\!*

*collective\\(ism\\)* — независимое кураторское объединение Иветты, Саши, и Маши, создательниц Численничка\\. Мы занимаемся теорией и практикой современного искусства, а наши интересы лежат на стыке арт\\-критики, философии и простоты\\. 
Следить за нашей работой можно в одноименном телеграм\\-канале *[collective\\(ism\\)](https://t.me/collective_ism)*\\.

*Численничек* — это проект отрывного календаря, начавший свой отсчёт дней в 2019 году\\. 
365 дней каждого года соответствуют 365 работам разных авторов, образующих вместе коллективное высказывание\\. Кураторки проекта ежегодно формулируют тему, предлагаемую для осмысления участникам\\. Итогом становится материальный объект — отрывной календарь, который в то же время является и коллективной выставкой, бережно собранной кураторской командой из вступающих в полилог работ художников и авторов из России и других стран\\. Численничек 2023 — последний выпуск календаря на сегодняшний день — посвящён феномену шифра, сокрытию, утаиванию и иносказанию\\.

Подробности о Численничке и нашей художественной практике читайте в \[журнале «Объединение»\]\(https://obdn.ru/articles/chislennichek\) или слушайте наш \[артист\\-ток\]\(https://garagemca.org/event/public-talk-from-chislennichek-to-collective-writing\), состоявшийся год назад в Музее современного искусства «Гараж»\\.`;

  try {
    await ctx.replyWithPhoto(
      "https://sun9-5.userapi.com/impg/dPW0_recZKs3soxLO_gAgpJcwZTIpQVvKjpBVg/Tr8LlhUYv8M.jpg?size=1728x2160&quality=95&sign=e43380a4d2f23a746411e6a4cb9d4a95&type=album"
    );

    const keyboard = new InlineKeyboard()
      .text("📆 Купить численничек 2023 📆", "buy")
      .row()
      .text("📬 Участвовать в опен колле 📬", "apply");

    await ctx.reply(markdownMessage, {
      parse_mode: "MarkdownV2",
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
  const keyboard = new InlineKeyboard()
    .text("Курьером (по Москве)", "curier")
    .text("Почта России", "post")
    .row()
    .text("Самовывоз (метро ул. 1905 года)", "pickup");

  await ctx.reply("Выберите способ доставки👇", {
    reply_markup: keyboard,
  });
});

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
  amountStep(ctx);
});

bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on("message:successful_payment", async (ctx) => {
  await ctx.reply("Спасибо, платеж прошел успешно! Мы скоро свяжемся с Вами");

  const deliveryData = ctx.session.deliveryData || "Выбран самовывоз";
  const username = ctx.from.username;

  const combinedData = `Девачки, пришел новый заказ💅💅💅\nИнформация по доставке: ${deliveryData}\nПользователь: @${username}`;

  await bot.api.sendMessage(process.env.CHAT_ID, combinedData);

  delete ctx.session.delivery;
  delete ctx.session.deliveryData;
});

// логика по опен коллу

bot.callbackQuery("apply", (ctx) => {
  ctx.answerCallbackQuery();

  ctx.session.step = "curatorText";
  const keyboard = new InlineKeyboard()
    .text("Условия участия", "rules")
    .row()
    .text("Заполнить заявку", "start_apply");

  ctx.reply(
    "«Если интернет отключат завтра, что вы возьмете с собой?» кураторский текст",
    {
      reply_markup: keyboard,
    }
  );
});

bot.callbackQuery("start_apply", (ctx) => {
  ctx.answerCallbackQuery();
  ctx.session.step = "bioInfo";
  ctx.reply("как звать?");
});

// создает ссылку для файла на гугл диске
async function getShareableFolderLink(folderId) {
  try {
    // First, create permission to make the folder shareable
    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    // Fetch the folder metadata to get the webViewLink
    const folder = await drive.files.get({
      fileId: folderId,
      fields: "webViewLink",
    });

    return folder.data.webViewLink;
  } catch (error) {
    console.error("Error generating shareable folder link:", error);
    throw error;
  }
}

bot.callbackQuery("saveAndSend", async (ctx) => {
  const session = ctx.session;

  ctx.answerCallbackQuery();
  ctx.reply("💽 сохраняем информацию, это может занять какое-то время");
  if (session.formData.files && session.formData.files.length > 0) {
    try {
      const fileLinks = [];
      const newFolderId = await uploadFilesToNewFolder(session.formData.name, session.formData.files)
      for (const file of session.formData.files) {
        try {
          // // Upload the file to Google Drive
          // const driveFileId = await uploadFile(file.filePath, file.fileName);
          // console.log(
          //   `Uploaded file ${file.fileName} to Google Drive with ID: ${driveFileId}`
          // );

          // const shareableLink = await getShareableLink(driveFileId);
          // console.log(
          //   `Shareable link for file ${file.fileName}: ${shareableLink}`
          // );

          // // Store the file link with a clickable name
          // fileLinks.push(`=HYPERLINK("${shareableLink}")`);

          // // Delete the file from the local folder after successful upload
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
          // const fileNames = session.formData[key].map((file) => file.fileName);
          values.push(`=HYPERLINK("${shareableLink}")`);
          // values.push(fileNames.join(", "));
        }
      }
      await appendToSheet(values);
      session.step = "finalStep";
      ctx.reply("Готово! Спасибо за заявку, ответим в первой неделе ноября");
    } catch (error) {
      console.error(`Failed to upload sheet`, error);
    }
    session.step = "finalStep";
  } else {
    ctx.reply("Вы не загрузили ни одного файла.");
  }
});

bot.callbackQuery("confirmSubmission", async (ctx) => {
  const session = ctx.session;

  ctx.answerCallbackQuery();
  if (session.formData.files && session.formData.files.length > 0) {
    await ctx.reply("Файлы были успешно сохранены");
    const keyboard = new InlineKeyboard()
      .text("Редактировать", "edit")
      .text("Сохранить и отправить", "saveAndSend");
    const allInfo = `Имя: ${session.formData.name}\nОписание работы: ${session.formData.description}\nЗагружено файлов: ${session.formData.files.length} \n\n Нажимая отправить вы соглашаетесь на предоставление информации организаторам опенколла.`;
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
    valueStep(ctx);
  } else if (session.step === "delivery") {
    session.deliveryData = ctx.msg.text;
    await ctx.reply("Спасибо, мы сохранили информацию о доставке");
    amountStep(ctx);
  }

  //logic for open call
  if (session.step === "bioInfo") {
    session.formData.name = ctx.message.text;
    session.formData.username = ctx.message.from.username;
    ctx.reply("Пришлите описание вашей работы");
    session.step = "collectDescription";
  } else if (session.step === "collectDescription") {
    session.formData.description = ctx.message.text;
    ctx.reply(
      "Отправьте до 10 файлов с вашей работой. Когда закончите отправьте слово «готово»"
    );
    session.step = "collectFile";
  } else if (session.step === "collectFile") {
    const keyboard = new InlineKeyboard().text("Готово", "confirmSubmission");
    if (ctx.message.document || ctx.message.photo) {
      const files = ctx.message.document
        ? [ctx.message.document]
        : [ctx.message.photo[ctx.message.photo.length - 1]];

      for (const fileObject of files) {
        const fileId = fileObject.file_id;
        const file = await ctx.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        const fileName = ctx.message.document
          ? ctx.message.document.file_name
          : `photo_${Date.now()}.jpg`;
        const filePath = path.join(__dirname, fileName);

        const response = await axios({
          url: fileUrl,
          method: "GET",
          responseType: "stream",
        });

        response.data.pipe(fs.createWriteStream(filePath));
        await new Promise((resolve) => response.data.on("end", resolve));

        if (!session.formData.files) {
          session.formData.files = [];
        }

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

      ctx.reply(
        `Вы загрузили ${
          session.formData.files.length
        } файла. Вы можете отправить еще ${
          10 - session.formData.files.length
        }.`,
        {
          reply_markup: keyboard,
        }
      );
    }
  }

  // if (session.step === "finalStep") {
  //   ctx.reply("Спасибо за заявку, ответим в первой неделе ноября");
  // }
});

bot.start();
