import { after } from "node:test";
import { closeRecommendationRedis } from "@learnspace/shared/recommendation-cache";

after(closeRecommendationRedis);
