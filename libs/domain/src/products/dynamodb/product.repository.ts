import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

import { ProductMapper } from "./product.mapper";
import { ProductRepository } from "../app/ports/product.repository.port";
import { Product } from "../domain/entities/product.entity";
import { ProductType } from "../domain/value-objects/product-type.vo";
import { ProductListFilters } from "../app/ports/product.repository.port";
import { Pagination } from "../app/ports/product.repository.port";
import { PaginatedResult } from "../app/ports/product.repository.port";
import crypto from "crypto";

interface ProductTargetingContext {
  userId?: string;
  country?: string;
  ipAddress?: string;
  entitlementKey?: string;
}

function hashToPercentage(input: string): number {
  const hash = crypto.createHash("md5").update(input).digest("hex");
  const num = parseInt(hash.slice(0, 8), 16);
  return num % 100;
}

function parseIpv4(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;

  const nums = parts.map((part) => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? n : NaN;
  });

  if (nums.some((n) => Number.isNaN(n))) return null;

  return (((nums[0] * 256 + nums[1]) * 256 + nums[2]) * 256 + nums[3]) >>> 0;
}

function parseIpv4Cidr(cidr: string): { network: number; mask: number } | null {
  const [ip, prefixRaw] = cidr.trim().split("/");

  if (!ip || prefixRaw === undefined) return null;

  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  const baseIp = parseIpv4(ip);
  if (baseIp === null) return null;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = baseIp & mask;

  return { network, mask };
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const parsedIp = parseIpv4(ip);
  const parsedCidr = parseIpv4Cidr(cidr);
  if (parsedIp === null || parsedCidr === null) return false;

  return (parsedIp & parsedCidr.mask) === parsedCidr.network;
}

function expandIpv6(ip: string): string[] | null {
  const value = ip.trim().toLowerCase();

  if (!value) return null;

  const hasIpv4Tail = value.includes(".");
  let working = value;
  let ipv4Tail: string[] = [];

  if (hasIpv4Tail) {
    const lastColon = working.lastIndexOf(":");
    if (lastColon < 0) return null;

    const tail = working.slice(lastColon + 1);
    const ipv4 = parseIpv4(tail);
    if (ipv4 === null) return null;

    const high = (ipv4 >>> 16) & 0xffff;
    const low = ipv4 & 0xffff;
    ipv4Tail = [high.toString(16), low.toString(16)];
    working = working.slice(0, lastColon);
  }

  const scetions = working.split("::");
  if (scetions.length > 2) return null;

  const left = scetions[0] ? scetions[0].split(":").filter(Boolean) : [];
  const right = scetions[1] ? scetions[1].split(":").filter(Boolean) : [];

  const totalNeeded = 8 - ipv4Tail.length;
  const missing = totalNeeded - (left.length + right.length);
  if (missing < 0) return null;

  const parts = [...left, ...Array(missing).fill("0"), ...right, ...ipv4Tail];
  if (parts.length !== 8) return null;

  return parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null as any;
    return part.padStart(4, "0");
  });
}

function ipv6ToBigInt(ip: string): bigint | null {
  const parts = expandIpv6(ip);
  if (!parts) return null;

  try {
    let result = 0n;
    for (const part of parts) {
      const value = BigInt(`0x${part}`);
      result = (result << 16n) + value;
    }
    return result;
  } catch {
    return null;
  }
}

function parseIpv6Cidr(cidr: string): { network: bigint; mask: bigint } | null {
  const [ip, prefixRaw] = cidr.trim().split("/");
  if (!ip || prefixRaw === undefined) return null;

  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;

  const baseIp = ipv6ToBigInt(ip);
  if (baseIp === null) return null;

  const mask =
    prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);

  const network = baseIp & mask;
  return { network, mask };
}

function isIpv6InCidr(ip: string, cidr: string): boolean {
  const parsedIp = ipv6ToBigInt(ip);
  const parsedCidr = parseIpv6Cidr(cidr);
  if (parsedIp === null || parsedCidr === null) return false;

  return (parsedIp & parsedCidr.mask) === parsedCidr.network;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    if (cidr.includes(".") && ip.includes(".")) {
      return isIpv4InCidr(ip, cidr);
    }

    if (cidr.includes(":") && ip.includes(":")) {
      return isIpv6InCidr(ip, cidr);
    }

    return false;
  } catch {
    return false;
  }
}

function isIpInCidrList(ip: string, cidrList: string[]): boolean {
  return cidrList.some((cidr) => isIpInCidr(ip, cidr));
}

function productMatchesTargeting(
  product: Product,
  context: ProductTargetingContext,
): boolean {
  const targeting = product.targeting;
  if (!targeting) {
    return true;
  }

  if (targeting.countries && targeting.countries.length > 0) {
    if (!context.country) {
      return false;
    }

    const requestCountry = context.country.trim().toUpperCase();
    const allowedCountries = targeting.countries
      .map((country) => country.trim().toUpperCase())
      .filter(Boolean);

    if (!allowedCountries.includes(requestCountry)) {
      return false;
    }
  }

  if (targeting.percentage !== undefined && targeting.percentage !== null) {
    if (!context.userId) {
      return false;
    }

    const salt = context.entitlementKey || product.productId;
    const bucket = hashToPercentage(`${context.userId}${salt}`);

    if (bucket >= targeting.percentage) {
      return false;
    }
  }

  if (targeting.cidrBlocks && targeting.cidrBlocks.length > 0) {
    if (!context.ipAddress) {
      return false;
    }

    if (!isIpInCidrList(context.ipAddress, targeting.cidrBlocks)) {
      return false;
    }
  }

  return true;
}

export class DynamoProductRepository implements ProductRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor() {
    const tableName = process.env.PRODUCTS_TABLE;
    if (!tableName) {
      throw new Error("PRODUCTS_TABLE environment variable is not set");
    }
    this.tableName = tableName;
    console.log(
      "DynamoProductRepository initialized with table:",
      this.tableName,
    );

    const raw = new DynamoDBClient({});
    this.client = DynamoDBDocumentClient.from(raw);
  }

  async create(product: Product): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: ProductMapper.toItem(product),
      }),
    );
  }

  async update(product: Product): Promise<void> {
    await this.create(product); // overwrite pattern
  }

  async delete(productId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: `PRODUCT#${productId}`,
          SK: "METADATA",
        },
      }),
    );
  }

  async findById(productId: string): Promise<Product | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `PRODUCT#${productId}`,
          SK: "METADATA",
        },
      }),
    );

    if (!result.Item) return null;
    return ProductMapper.toDomain(result.Item);
  }

  async list(
    filters: ProductListFilters,
    pagination: Pagination,
  ): Promise<PaginatedResult<Product>> {
    const pageSize = pagination.pageSize;
    const pageNumber = pagination.pageNumber;

    if (pageNumber < 1) {
      throw new Error("pageNumber must be >= 1");
    }

    // We emulate offset pagination by iterating pages internally
    let lastEvaluatedKey: any = undefined;
    let filteredScanned = 0;
    let items: Product[] = [];

    const pk = filters.type
      ? `TYPE#${filters.type}`
      : `TYPE#${ProductType.SUBSCRIPTION}`; // default view

    // When filtering by entitlementKey, namePrefix, or targeting fields, fetch larger batches so we can fill a page without many round trips
    const hasClientSideFilter = Boolean(
      filters.entitlementKey ||
        filters.namePrefix ||
        filters.userId ||
        filters.country ||
        filters.ipAddress,
    );
    const dynamoLimit = hasClientSideFilter
      ? Math.max(pageSize * 5, 100)
      : pageSize;

    // Continue fetching until we have enough filtered items for the target page
    while (filteredScanned < pageNumber * pageSize) {
      const filterExpressions: string[] = [];
      const expressionAttributeValues: Record<string, any> = {
        ":pk": pk,
      };

      if (filters.isActive !== undefined) {
        filterExpressions.push("isActive = :active");
        expressionAttributeValues[":active"] = filters.isActive;
      }

      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: expressionAttributeValues,
          ...(filterExpressions.length > 0 && {
            FilterExpression: filterExpressions.join(" AND "),
          }),
          Limit: dynamoLimit,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      lastEvaluatedKey = result.LastEvaluatedKey;

      let batch = (result.Items ?? []).map(ProductMapper.toDomain);

      batch = batch.filter((product) =>
        productMatchesTargeting(product, {
          userId: filters.userId,
          country: filters.country,
          ipAddress: filters.ipAddress,
          entitlementKey: filters.entitlementKey,
        }),
      );

      // Filter by namePrefix if provided (client-side filtering since begins_with can't be used in FilterExpression)
      if (filters.namePrefix) {
        batch = batch.filter((product) =>
          product.name
            .toLowerCase()
            .startsWith(filters.namePrefix!.toLowerCase()),
        );
      }

      // Filter by entitlementKey if provided (only products that include this entitlement)
      if (filters.entitlementKey) {
        batch = batch.filter((product) =>
          product.entitlements.some((e) => e === filters.entitlementKey),
        );
      }

      // Only add items that belong to the target page
      const startIndex = (pageNumber - 1) * pageSize;
      const endIndex = pageNumber * pageSize;

      for (const item of batch) {
        if (filteredScanned >= startIndex && filteredScanned < endIndex) {
          items.push(item);
        }
        filteredScanned++;
      }

      if (!lastEvaluatedKey) break;
    }

    return {
      items: items.slice(0, pageSize),
      total: -1, // DynamoDB doesn't do totals cheaply
      pageNumber,
      pageSize,
    };
  }
}
