var Router = new (require("jb-router"))();

Router.Listen({ "Port": 8000 });
Router.Get(/(.*)/, Router.StaticHandler(".."));

