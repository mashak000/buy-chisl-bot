const { Bot, session, InlineKeyboard } = require("grammy");
require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { authorize } = require("./auth");

const bot = new Bot(process.env.BOT_TOKEN);

// const auth = authorize();
// const drive = google.drive({ version: "v3", auth });
// const sheets = google.sheets({ version: "v4", auth });

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
}

const valueStep = (ctx) => {
  ctx.session.amount = ctx.message.text; 
  ctx.reply("Введите сумму доната (только число, не менее 500)");
  ctx.session.step = "payment";
};

const paymentStep = async (ctx) => {
  const usersAmount = parseInt(ctx.msg.text, 10) * parseInt(ctx.session.amount);

  if (isNaN(usersAmount) || usersAmount < 100) {
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

// загружает на Google Drive
//  async function uploadFile(filePath, fileName) {
//   try {
//     const fileMetadata = {
//       name: fileName,
//       parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
//     };
//     const media = {
//       mimeType: "application/octet-stream",
//       body: fs.createReadStream(filePath),
//     };
//     const response = await drive.files.create({
//       resource: fileMetadata,
//       media: media,
//       fields: "id",
//     });
//     console.log("File uploaded to Google Drive, ID:", response.data.id);
//     return response.data.id;
//   } catch (error) {
//     console.error("Error uploading file to Google Drive:", error);
//     throw new Error("Failed to upload file to Google Drive");
//   }
// } 

// добавляет строку в гугл таблицу
// async function appendToSheet(sheetId, values) {
//   const resource = {
//     values: [values],
//   };
//   await sheets.spreadsheets.values.append({
//     spreadsheetId: sheetId,
//     range: "aplication!A1",
//     valueInputOption: "RAW",
//     resource: resource,
//   });
// }

bot.command("start", async (ctx) => {
  const markdownMessage = `
*Привет, ${ctx.from.first_name}\\!*
_Это бот распродажи Численничков 2023 за донат\\._

Численничек это проект отрывного календаря, существовавший с 2019 по 2023 год\\. В его создании принимали участие 365 человек\\. Участнику для воплощения собственной идеи отводился один календарный лист, который затем становился частью коллективного высказывания\\. 

Сумма доната начинается от 500 рублей\\.

Если возникли проблемы, отправьте /help

⚠️Обратите внимание, календарь на 2023 год⚠️
`;

  try {
    await ctx.replyWithPhoto(
      "https://sun9-5.userapi.com/impg/dPW0_recZKs3soxLO_gAgpJcwZTIpQVvKjpBVg/Tr8LlhUYv8M.jpg?size=1728x2160&quality=95&sign=e43380a4d2f23a746411e6a4cb9d4a95&type=album"
    );

    const keyboard = new InlineKeyboard()
      .text("Купить", "buy")
      .text("Open Call", "apply");

    await ctx.reply(markdownMessage, {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
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
});

bot.callbackQuery("post", async (ctx) => {
  ctx.session.delivery = "post";
  await ctx.reply(
    "Пожалуйста, пришлите адрес доставки, индекс, ФИО получателя, а также контактный номер телефона"
  );
});

bot.callbackQuery("pickup", async (ctx) => {
  ctx.session.delivery = "pickup";
  amountStep(ctx);
});

bot.on("message:text", async (ctx) => {
  if (ctx.session.step === "payment") {
    await paymentStep(ctx);
  } else if (ctx.session.step === "amount") {
    valueStep(ctx)
  } else if (ctx.session.delivery !== "pickup") {
    ctx.session.deliveryData = ctx.msg.text;
    await ctx.reply("Спасибо, мы сохранили информацию о доставке");
    amountStep(ctx);
  } 
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

bot.callbackQuery("apply", (ctx) => {
  ctx.answerCallbackQuery();

  ctx.session.step = "curatorText";
  ctx.reply(
    "«Все свое ношу с собой» — поделитесь своей коллекцией и тут бла бла бла бла бла "
  );
  // ctx.reply("Пришлите ваше имя или псевдоним");
});

// bot.on("message", async (ctx) => {
//   const session = ctx.session;

//   if (session.step === "curatorText") {
//     session.formData.name = ctx.message.text;
//     ctx.reply("Пришлите описание вашей работы");
//     session.step = "collectDescription";
//   } else if (session.step === "collectDescription") {
//     session.formData.description = ctx.message.text;
//     ctx.reply(
//       "Отправьте до 10 файлов с вашей работой. Когда закончите отправьте слово «готово»"
//     );
//     session.step = "collectFile";
//   } else if (session.step === "collectFile") {
//     if (ctx.message.document || ctx.message.photo) {
//       const files = ctx.message.document
//         ? [ctx.message.document]
//         : ctx.message.photo;

//       for (const fileObject of files) {
//         const fileId = fileObject.file_id;
//         const file = await ctx.api.getFile(fileId);
//         const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
//         const fileName = ctx.message.document
//           ? ctx.message.document.file_name
//           : `photo_${Date.now()}.jpg`;
//         const filePath = path.join(__dirname, fileName);

//         const response = await axios({
//           url: fileUrl,
//           method: "GET",
//           responseType: "stream",
//         });

//         response.data.pipe(fs.createWriteStream(filePath));
//         await new Promise((resolve) => response.data.on("end", resolve));

//         if (!session.formData.files) {
//           session.formData.files = [];
//         }

//         session.formData.files.push({
//           filePath: filePath,
//           fileName: fileName,
//         });

//         if (session.formData.files.length >= 10) {
//           ctx.reply(
//             "You have uploaded the maximum number of files. Please send a description of your work:"
//           );
//           session.step = "collectDescription";
//           return;
//         }
//       }
//       ctx.reply(
//         `You have uploaded ${
//           session.formData.files.length
//         } file(s). You can send up to ${
//           10 - session.formData.files.length
//         } more file(s) or type 'done' to finish uploading.`
//       );
//     } else if (
//       ctx.message.text &&
//       ctx.message.text.toLowerCase() === "готово"
//     ) {
//       if (session.formData.files && session.formData.files.length > 0) {
//         ctx.reply("Файлы были успешно сохранены");
//         session.step = "confirmSubmission";
//       } else {
//         ctx.reply("You haven't uploaded any files yet. Please send a fileb.");
//       }
//     } else {
//       ctx.reply(
//         "Please send valid files or type 'done' if you have finished uploading."
//       );
//     }
//   } else if (session.step === "confirmSubmission") {
//     const keyboard = new InlineKeyboard().text("Сохранить и отправить", "send");
//     ctx.reply("lsdls", {
//       reply_markup: keyboard,
//     });
//   }
// });

bot.start();
