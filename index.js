const { Telegraf, Markup, Scenes, session } = require("telegraf");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const sendDataToSpecificChat = async (chatId, message) => {
    try {
      await bot.telegram.sendMessage(chatId, message);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

const deliveryOptions = {
  courier: {
    price: 0,
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
    chat_id: id, // Unique identifier of the target chat or username of the target channel
    provider_token: process.env.PROVIDER_TOKEN, // token issued via bot @SberbankPaymentBot
    start_parameter: "get_access", // Unique parameter for deep links. If you leave this field blank, forwarded copies of the forwarded message will have a Pay button that allows multiple users to pay directly from the forwarded message using the same account. If not empty, redirected copies of the sent message will have a URL button with a deep link to the bot (instead of a payment button) with a value used as an initial parameter.
    title: "Численничек 2023", // Product name, 1-32 characters
    description: "⚠️Обратите внимание, календарь на 2023 год⚠️", // Product description, 1-255 characters
    currency: "RUB", // ISO 4217 Three-Letter Currency Code
    prices: [{ label: "Численничек 2023", amount: 100 * usersAmount }], // Price breakdown, serialized list of components in JSON format 100 kopecks * 100 = 100 rubles
    payload: {
      // The payload of the invoice, as determined by the bot, 1-128 bytes. This will not be visible to the user, use it for your internal processes.
      unique_id: `${id}_${Number(new Date())}`,
      provider_token: process.env.PROVIDER_TOKEN,
    },
  };
  return invoice;
};

bot.use(Telegraf.log());

const valueStep = (ctx) => {
  ctx.reply("Введите сумму доната (только число, не менее 500)");
  ctx.wizard.next()
};
const paymentStep = (ctx) => {
  const usersAmount = parseInt(ctx.message.text, 10);

  if (isNaN(usersAmount) || usersAmount < 499) {
    ctx.reply("Пожалуйста, введите сумму не менее 500");
  } else {
    const totalAmount = deliveryOptions[ctx.session.delivery].price + usersAmount
    ctx.replyWithInvoice(getInvoice(ctx.from.id, totalAmount));
    ctx.scene.leave();
  }
};

const userWizard = new Scenes.WizardScene("userWizard", valueStep, paymentStep);
const stage = new Scenes.Stage([userWizard]);
bot.use(session());
bot.use(stage.middleware());

bot.start((ctx) => {
  const markdownMessage = `
  *Привет, ${ctx.update.message.from.first_name}!*
_Это бот распродажи Численничков 2023 за донат._

Численничек это проект отрывного календаря, существовавший с 2019 по 2023 год. В его создании принимали участие 365 человек. Участнику для воплощения собственной идеи отводился один календарный лист, который затем становился частью коллективного высказывания. 

Сумма доната начинается от 500 рублей.

Если возникли проблемы, отправьте /help

  ⚠️Обратите внимание, календарь на 2023 год⚠️
  `;

  ctx
    .replyWithPhoto({
      url: "https://sun9-5.userapi.com/impg/dPW0_recZKs3soxLO_gAgpJcwZTIpQVvKjpBVg/Tr8LlhUYv8M.jpg?size=1728x2160&quality=95&sign=e43380a4d2f23a746411e6a4cb9d4a95&type=album",
    })
    .then(() => {
      ctx.replyWithMarkdown(
        markdownMessage,
        Markup.inlineKeyboard([Markup.button.callback("Купить", "buy")])
      );
    });
});

bot.help((ctx) => {
  ctx.reply('Если вам не удалось оформить заказ, попробуйте очистить историию диалога и заполнить информацию заново. Если и это не помогло, напишите, пожалуйста, @mashak000')
})

bot.action("buy", (ctx) => {
  ctx.reply(
    "Выберите способ доставки👇",
    Markup.inlineKeyboard([
      [Markup.button.callback("Курьером (по Москве)", "curier")],
      [Markup.button.callback("Почта России", "post")],
      [Markup.button.callback("Самовывоз (метро ул. 1905 года)", "pickup")],
    ])
  );
});

bot.action("curier", (ctx) => {
  ctx.session.delivery = "courier";
  ctx.reply(
    "Пожалуйста, пришлите адрес доставки, а также контактный номер телефона"
  );
});

bot.action("post", (ctx) => {
  ctx.session.delivery = "post";
  ctx.reply(
    "Пожалуйста, пришлите адрес доставки, индекс, ФИО получателя, а также контактный номер телефона"
  );
});

bot.action("pickup", (ctx) => {
  ctx.session.delivery = "pickup";
  ctx.scene.enter("userWizard");
});

bot.on("text", async (ctx) => {
  if (ctx.session.delivery !== 'pickup') {
    ctx.session.deliveryData = ctx.message.text;
    ctx.reply("Спасибо мы сохранили информацию о достаке").then(async() => {
      if (ctx.session.deliveryData) {
        ctx.scene.enter("userWizard");
      }
    });
  }
});

bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true)); 

bot.on("successful_payment", async (ctx) => {
    await ctx.reply("Спасибо, платеж прошел успешно! Мы скоро свяжемся с Вами");
    let deliveryData;
    if(ctx.session.deliveryData){
      deliveryData = ctx.session.deliveryData
    } else {
      deliveryData = 'Выбран самовывоз'
    }
    const username = ctx.from.username
    // const paymentData = `Invoice ID: ${ctx.update.message.successful_payment}`;
    const combinedData = `Девачки, пришел новый заказ💅💅💅\n Информация по достаке: ${deliveryData}\nПользователь: @${username}`;
    await sendDataToSpecificChat(process.env.CHAT_ID, combinedData);
    delete ctx.session.delivery;
    delete ctx.session.deliveryData;
  });

bot.launch();
